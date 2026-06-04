import * as http from 'http'
import si from 'systeminformation'
import {
  CollectorOptions,
  TelemetryExport,
  TelemetrySamples,
  TelemetrySummary
} from './types'

const HOST = 'localhost'
const BYTES_PER_MB = 1024 * 1024
const IS_WINDOWS = process.platform === 'win32'

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function getMetricOrDefault<T>(
  collect: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await collect()
  } catch {
    return fallback
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

function createEmptySamples(): TelemetrySamples {
  return {
    cpu: [],
    memory: [],
    network: [],
    disk: [],
    disk_size: []
  }
}

function calculateSummary(samples: TelemetrySamples): TelemetrySummary {
  return {
    sample_count: Math.max(
      samples.cpu.length,
      samples.memory.length,
      samples.network.length,
      samples.disk.length,
      samples.disk_size.length
    ),
    cpu_total_load_avg: avg(samples.cpu.map(sample => sample.total_load)),
    cpu_total_load_max: max(samples.cpu.map(sample => sample.total_load)),
    memory_active_mb_max: max(samples.memory.map(sample => sample.active_mb)),
    network_rx_mb_total: sum(samples.network.map(sample => sample.rx_mb)),
    network_tx_mb_total: sum(samples.network.map(sample => sample.tx_mb)),
    disk_read_mb_total: sum(samples.disk.map(sample => sample.read_mb)),
    disk_write_mb_total: sum(samples.disk.map(sample => sample.write_mb))
  }
}

function createTelemetryExport(
  startedAt: string,
  frequencyMs: number,
  samples: TelemetrySamples
): TelemetryExport {
  return {
    schema_version: '1',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    frequency_ms: frequencyMs,
    samples,
    summary: calculateSummary(samples)
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
  const samples = createEmptySamples()
  let lastSampleTime = 0
  let collectionInFlight: Promise<void> | undefined

  async function collectSample(): Promise<void> {
    if (collectionInFlight) {
      await collectionInFlight
      return
    }

    collectionInFlight = (async () => {
      const time = Date.now()
      const intervalMs = lastSampleTime === 0 ? 0 : time - lastSampleTime
      lastSampleTime = time

      const [cpu, memory, network, disk, diskSize] = await Promise.all([
        getMetricOrDefault(() => si.currentLoad(), {
          currentLoad: 0,
          currentLoadUser: 0,
          currentLoadSystem: 0
        } as Awaited<ReturnType<typeof si.currentLoad>>),
        getMetricOrDefault(() => si.mem(), {
          total: 0,
          active: 0,
          available: 0
        } as Awaited<ReturnType<typeof si.mem>>),
        IS_WINDOWS
          ? Promise.resolve([] as Awaited<ReturnType<typeof si.networkStats>>)
          : getMetricOrDefault(
              () => si.networkStats(),
              [] as Awaited<ReturnType<typeof si.networkStats>>
            ),
        getMetricOrDefault(() => si.fsStats(), {
          rx_sec: 0,
          wx_sec: 0
        } as Awaited<ReturnType<typeof si.fsStats>>),
        getMetricOrDefault(
          () => si.fsSize(),
          [] as Awaited<ReturnType<typeof si.fsSize>>
        )
      ])

      let rxBytesPerSecond = 0
      let txBytesPerSecond = 0

      for (const adapter of network ?? []) {
        if (!adapter) {
          continue
        }

        rxBytesPerSecond += safeNumber(adapter.rx_sec)
        txBytesPerSecond += safeNumber(adapter.tx_sec)
      }

      let totalDiskBytes = 0
      let usedDiskBytes = 0

      for (const filesystem of diskSize ?? []) {
        if (!filesystem) {
          continue
        }

        totalDiskBytes += safeNumber(filesystem.size)
        usedDiskBytes += safeNumber(filesystem.used)
      }

      samples.cpu.push({
        time,
        total_load: round(safeNumber(cpu.currentLoad)),
        user_load: round(safeNumber(cpu.currentLoadUser)),
        system_load: round(safeNumber(cpu.currentLoadSystem))
      })
      samples.memory.push({
        time,
        total_mb: round(safeNumber(memory.total) / BYTES_PER_MB),
        active_mb: round(safeNumber(memory.active) / BYTES_PER_MB),
        available_mb: round(safeNumber(memory.available) / BYTES_PER_MB)
      })
      samples.network.push({
        time,
        rx_mb: round((rxBytesPerSecond * (intervalMs / 1000)) / BYTES_PER_MB),
        tx_mb: round((txBytesPerSecond * (intervalMs / 1000)) / BYTES_PER_MB)
      })
      samples.disk.push({
        time,
        read_mb: round(
          (safeNumber(disk.rx_sec) * (intervalMs / 1000)) / BYTES_PER_MB
        ),
        write_mb: round(
          (safeNumber(disk.wx_sec) * (intervalMs / 1000)) / BYTES_PER_MB
        )
      })
      samples.disk_size.push({
        time,
        available_mb: round((totalDiskBytes - usedDiskBytes) / BYTES_PER_MB),
        used_mb: round(usedDiskBytes / BYTES_PER_MB)
      })
    })()

    try {
      await collectionInFlight
    } finally {
      collectionInFlight = undefined
    }
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
            sample_count: calculateSummary(samples).sample_count
          })
          return
        }

        if (route === '/metrics' && request.method === 'GET') {
          sendJson(
            response,
            200,
            createTelemetryExport(startedAt, options.frequencyMs, samples)
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

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })

  await collectSample()

  const timer = setInterval(() => {
    void collectSample()
  }, options.frequencyMs)

  timer.unref()
}
