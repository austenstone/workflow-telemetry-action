import * as core from '@actions/core'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import * as http from 'http'
import * as path from 'path'
import * as logger from './logger'
import { CollectorOptions, ExportOptions, TelemetryExport } from './types'

const HOST = 'localhost'
const WORKER_ARG = '--worker'
const HEALTH_TIMEOUT_MS = 10_000
const HEALTH_POLL_MS = 250
const HEALTH_REQUEST_TIMEOUT_MS = 1000
const REQUEST_TIMEOUT_MS = 60_000

interface HttpResponse {
  readonly statusCode: number
  readonly body: string
}

async function request(
  method: 'GET' | 'POST',
  port: number,
  route: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<HttpResponse> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port,
        path: route,
        method,
        timeout: timeoutMs
      },
      res => {
        const chunks: Buffer[] = []

        res.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error(`${method} ${route} timed out`))
    })
    req.on('error', reject)
    req.end()
  })
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError = 'collector did not respond'

  while (Date.now() < deadline) {
    try {
      const response = await request(
        'GET',
        port,
        '/health',
        HEALTH_REQUEST_TIMEOUT_MS
      )

      if (response.statusCode === 200) {
        return
      }

      lastError = `/health returned ${response.statusCode}`
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(HEALTH_POLL_MS)
  }

  throw new Error(`collector failed health check: ${lastError}`)
}

async function parseMetrics(response: HttpResponse): Promise<TelemetryExport> {
  if (response.statusCode !== 200) {
    throw new Error(
      `/metrics returned ${response.statusCode}: ${response.body}`
    )
  }

  return JSON.parse(response.body) as TelemetryExport
}

export async function startCollector(options: CollectorOptions): Promise<void> {
  logger.info(
    `Starting telemetry collector on ${HOST}:${options.port} every ${options.frequencyMs}ms`
  )

  const child = spawn(process.execPath, [__filename, WORKER_ARG], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WORKFLOW_TELEMETRY_SERVER_PORT: String(options.port),
      WORKFLOW_TELEMETRY_FREQUENCY_MS: String(options.frequencyMs)
    }
  })

  child.unref()

  await waitForHealth(options.port)

  logger.info(
    `Telemetry collector is healthy with pid ${child.pid ?? 'unknown'}`
  )
}

export async function exportCollector(options: ExportOptions): Promise<void> {
  logger.info(`Exporting telemetry from ${HOST}:${options.port}`)

  const collectResponse = await request('POST', options.port, '/collect')

  if (collectResponse.statusCode !== 200) {
    throw new Error(
      `/collect returned ${collectResponse.statusCode}: ${collectResponse.body}`
    )
  }

  const metrics = await parseMetrics(
    await request('GET', options.port, '/metrics')
  )
  const outputPath = path.resolve(options.outputPath)

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(metrics, null, 2)}\n`,
    'utf8'
  )

  core.setOutput('telemetry_path', outputPath)
  core.setOutput('sample_count', String(metrics.summary.sample_count))

  logger.info(
    `Wrote ${metrics.summary.sample_count} telemetry samples to ${outputPath}`
  )

  try {
    await request('POST', options.port, '/shutdown')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.debug(`Collector shutdown request failed: ${message}`)
  }
}
