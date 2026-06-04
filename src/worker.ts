import * as http from 'http'
import si from 'systeminformation'
import {
  CollectorOptions,
  JsonValue,
  TelemetryError,
  TelemetryExport,
  TelemetrySample,
  TelemetrySummary
} from './types'

const HOST = 'localhost'
const BYTES_PER_MB = 1024 * 1024

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function getNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toJsonValue(value: unknown): JsonValue {
  const json = JSON.stringify(value)

  if (json === undefined) {
    return null
  }

  return JSON.parse(json) as JsonValue
}

async function collectJsonMetric(
  metric: string,
  collect: () => Promise<unknown>,
  errors: TelemetryError[]
): Promise<JsonValue | null> {
  try {
    return toJsonValue(await collect())
  } catch (error: unknown) {
    errors.push({ time: Date.now(), metric, message: errorMessage(error) })
    return null
  }
}

function sum(values: readonly number[]): number {
  return round(values.reduce((total, value) => total + value, 0))
}

function max(values: readonly number[]): number {
  return values.length > 0 ? round(Math.max(...values)) : 0
}

function avg(values: readonly number[]): number {
  return values.length > 0 ? round(sum(values) / values.length) : 0
}

function sampleIntervalSeconds(
  samples: readonly TelemetrySample[],
  index: number
): number {
  if (index === 0) {
    return 0
  }

  return Math.max(samples[index].time - samples[index - 1].time, 0) / 1000
}

function calculateSummary(
  samples: readonly TelemetrySample[]
): TelemetrySummary {
  const cpuLoads: number[] = []
  const memoryActiveMb: number[] = []
  const networkRxMb: number[] = []
  const networkTxMb: number[] = []
  const diskReadMb: number[] = []
  const diskWriteMb: number[] = []

  for (const [index, sample] of samples.entries()) {
    const dynamic = getObject(sample.dynamic)
    const currentLoad = getObject(dynamic.currentLoad)
    const mem = getObject(dynamic.mem)
    const networkStats = getArray(dynamic.networkStats)
    const fsStats = getObject(dynamic.fsStats)
    const intervalSeconds = sampleIntervalSeconds(samples, index)

    cpuLoads.push(getNumber(currentLoad.currentLoad))
    memoryActiveMb.push(getNumber(mem.active) / BYTES_PER_MB)

    let rxBytesPerSecond = 0
    let txBytesPerSecond = 0

    for (const adapter of networkStats) {
      const adapterStats = getObject(adapter)

      rxBytesPerSecond += getNumber(adapterStats.rx_sec)
      txBytesPerSecond += getNumber(adapterStats.tx_sec)
    }

    networkRxMb.push((rxBytesPerSecond * intervalSeconds) / BYTES_PER_MB)
    networkTxMb.push((txBytesPerSecond * intervalSeconds) / BYTES_PER_MB)
    diskReadMb.push(
      (getNumber(fsStats.rx_sec) * intervalSeconds) / BYTES_PER_MB
    )
    diskWriteMb.push(
      (getNumber(fsStats.wx_sec) * intervalSeconds) / BYTES_PER_MB
    )
  }

  return {
    sample_count: samples.length,
    cpu_load_avg: avg(cpuLoads),
    cpu_load_max: max(cpuLoads),
    memory_active_mb_max: max(memoryActiveMb),
    network_rx_mb_total: sum(networkRxMb),
    network_tx_mb_total: sum(networkTxMb),
    disk_read_mb_total: sum(diskReadMb),
    disk_write_mb_total: sum(diskWriteMb)
  }
}

function createTelemetryExport(
  startedAt: string,
  frequencyMs: number,
  staticData: JsonValue,
  samples: TelemetrySample[],
  errors: TelemetryError[]
): TelemetryExport {
  return {
    schema_version: '2',
    source: {
      name: 'systeminformation',
      version: si.version()
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    frequency_ms: frequencyMs,
    static: staticData,
    samples,
    summary: calculateSummary(samples),
    errors
  }
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: unknown
): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function sendEmpty(response: http.ServerResponse, statusCode: number): void {
  response.writeHead(statusCode)
  response.end()
}

export async function startWorkerServer(
  options: CollectorOptions
): Promise<void> {
  const startedAt = new Date().toISOString()
  const samples: TelemetrySample[] = []
  const errors: TelemetryError[] = []
  let staticData: JsonValue = {}
  let staticDataPromise = Promise.resolve()

  async function collectStaticData(): Promise<void> {
    const collected = await collectJsonMetric(
      'getStaticData',
      async () => await si.getStaticData(),
      errors
    )

    staticData = collected ?? {}
  }

  const server = http.createServer((request, response) => {
    const route = new URL(request.url || '/', `http://${HOST}`).pathname

    void (async () => {
      try {
        if (route === '/health' && request.method === 'GET') {
          sendJson(response, 200, { ok: true })
          return
        }

        if (route === '/collect' && request.method === 'POST') {
          await collectSample()
          sendJson(response, 200, {
            sample_count: samples.length
          })
          return
        }

        if (route === '/metrics' && request.method === 'GET') {
          await staticDataPromise
          sendJson(
            response,
            200,
            createTelemetryExport(
              startedAt,
              options.frequencyMs,
              staticData,
              samples,
              errors
            )
          )
          return
        }

        if (route === '/shutdown' && request.method === 'POST') {
          sendJson(response, 200, { ok: true })
          server.close(() => process.exit(0))
          return
        }

        if (
          route === '/health' ||
          route === '/collect' ||
          route === '/metrics' ||
          route === '/shutdown'
        ) {
          sendEmpty(response, 405)
          return
        }

        sendEmpty(response, 404)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(response, 500, { message })
      }
    })()
  })

  let collectionInFlight: Promise<void> | undefined

  async function collectSample(): Promise<void> {
    if (collectionInFlight) {
      await collectionInFlight
      return
    }

    collectionInFlight = (async () => {
      const time = Date.now()

      const dynamic = await collectJsonMetric(
        'getDynamicData',
        async () => await si.getDynamicData('', '*'),
        errors
      )

      samples.push({
        time,
        dynamic: dynamic ?? {}
      })
    })()

    try {
      await collectionInFlight
    } finally {
      collectionInFlight = undefined
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })

  staticDataPromise = collectStaticData()
  void collectSample()

  const timer = setInterval(() => {
    void collectSample()
  }, options.frequencyMs)

  timer.unref()
}
