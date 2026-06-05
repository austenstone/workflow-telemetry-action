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

// The fields we read from a sample's dynamic blob. Optional because any metric
// can be missing when a collection partially fails (see the errors array).
interface SampledMetrics {
  readonly currentLoad?: { readonly currentLoad?: number }
  readonly mem?: { readonly active?: number }
  readonly networkStats?: readonly {
    readonly rx_sec?: number
    readonly tx_sec?: number
  }[]
  readonly fsStats?: { readonly rx_sec?: number; readonly wx_sec?: number }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function getNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
    const metrics = sample.dynamic as SampledMetrics
    const intervalSeconds = sampleIntervalSeconds(samples, index)

    cpuLoads.push(getNumber(metrics.currentLoad?.currentLoad))
    memoryActiveMb.push(getNumber(metrics.mem?.active) / BYTES_PER_MB)

    let rxBytesPerSecond = 0
    let txBytesPerSecond = 0

    for (const adapter of metrics.networkStats ?? []) {
      rxBytesPerSecond += getNumber(adapter.rx_sec)
      txBytesPerSecond += getNumber(adapter.tx_sec)
    }

    networkRxMb.push((rxBytesPerSecond * intervalSeconds) / BYTES_PER_MB)
    networkTxMb.push((txBytesPerSecond * intervalSeconds) / BYTES_PER_MB)
    diskReadMb.push(
      (getNumber(metrics.fsStats?.rx_sec) * intervalSeconds) / BYTES_PER_MB
    )
    diskWriteMb.push(
      (getNumber(metrics.fsStats?.wx_sec) * intervalSeconds) / BYTES_PER_MB
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
  startedAtMs: number,
  finishedAtMs: number,
  frequencyMs: number,
  staticData: JsonValue,
  samples: TelemetrySample[],
  errors: TelemetryError[]
): TelemetryExport {
  const windowSamples = samples.filter(
    sample => sample.time >= startedAtMs && sample.time <= finishedAtMs
  )

  return {
    schema_version: '3',
    source: {
      name: 'systeminformation',
      version: si.version()
    },
    started_at: new Date(startedAtMs).toISOString(),
    finished_at: new Date(finishedAtMs).toISOString(),
    frequency_ms: frequencyMs,
    static: staticData,
    samples: windowSamples,
    summary: calculateSummary(windowSamples),
    job: null,
    errors
  }
}

function getTimeParameter(url: URL): number | undefined {
  const rawTime = url.searchParams.get('time')

  if (!rawTime) {
    return undefined
  }

  const time = Number(rawTime)

  return Number.isFinite(time) && time > 0 ? time : undefined
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
  const serverStartedAtMs = Date.now()
  const samples: TelemetrySample[] = []
  const errors: TelemetryError[] = []
  let collectionStartedAtMs = serverStartedAtMs
  let collectionFinishedAtMs: number | undefined
  let samplingTimer: ReturnType<typeof setInterval> | undefined
  let staticData: JsonValue = {}
  let staticDataPromise: Promise<void> | undefined

  async function collectStaticData(): Promise<void> {
    const collected = await collectJsonMetric(
      'getStaticData',
      async () => await si.getStaticData(),
      errors
    )

    staticData = collected ?? {}
  }

  async function ensureStaticData(): Promise<void> {
    if (!staticDataPromise) {
      staticDataPromise = collectStaticData()
    }

    await staticDataPromise
  }

  function startSampling(startedAtMs: number): void {
    collectionStartedAtMs = startedAtMs
    collectionFinishedAtMs = undefined

    if (samplingTimer) {
      return
    }

    samplingTimer = setInterval(() => {
      void collectSample()
    }, options.frequencyMs)

    samplingTimer.unref()
  }

  function stopSampling(finishedAtMs: number): void {
    collectionFinishedAtMs = finishedAtMs

    if (!samplingTimer) {
      return
    }

    clearInterval(samplingTimer)
    samplingTimer = undefined
  }

  function hasWindowSamples(): boolean {
    const finishedAtMs = collectionFinishedAtMs ?? Date.now()

    return samples.some(
      sample =>
        sample.time >= collectionStartedAtMs && sample.time <= finishedAtMs
    )
  }

  async function ensureWindowSample(): Promise<void> {
    if (hasWindowSamples()) {
      return
    }

    if (collectionInFlight) {
      await collectionInFlight

      if (hasWindowSamples()) {
        return
      }
    }

    await collectSample(collectionFinishedAtMs ?? Date.now())
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${HOST}`)
    const route = url.pathname

    void (async () => {
      try {
        if (route === '/health' && request.method === 'GET') {
          sendJson(response, 200, { ok: true })
          return
        }

        if (route === '/prepare' && request.method === 'POST') {
          await ensureStaticData()
          sendJson(response, 200, { ok: true })
          return
        }

        if (route === '/start' && request.method === 'POST') {
          startSampling(getTimeParameter(url) ?? Date.now())
          sendJson(response, 200, { ok: true })
          return
        }

        if (route === '/stop' && request.method === 'POST') {
          stopSampling(getTimeParameter(url) ?? Date.now())
          sendJson(response, 200, {
            sample_count: samples.length
          })
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
          if (!collectionFinishedAtMs) {
            stopSampling(Date.now())
          }

          await ensureWindowSample()
          await ensureStaticData()
          sendJson(
            response,
            200,
            createTelemetryExport(
              collectionStartedAtMs,
              collectionFinishedAtMs ?? Date.now(),
              options.frequencyMs,
              staticData,
              samples,
              errors
            )
          )
          return
        }

        if (route === '/shutdown' && request.method === 'POST') {
          stopSampling(Date.now())
          sendJson(response, 200, { ok: true })
          server.close(() => process.exit(0))
          return
        }

        if (
          route === '/health' ||
          route === '/prepare' ||
          route === '/start' ||
          route === '/stop' ||
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

  async function collectSample(time = Date.now()): Promise<void> {
    if (collectionInFlight) {
      await collectionInFlight
      return
    }

    collectionInFlight = (async () => {
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
}
