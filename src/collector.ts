import * as core from '@actions/core'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import * as http from 'http'
import * as path from 'path'
import { collectJob, formatStepTrace } from './job'
import * as logger from './logger'
import {
  CollectorOptions,
  ExportOptions,
  JsonValue,
  TelemetryExport
} from './types'

const HOST = 'localhost'
const WORKER_ARG = '--worker'
const HEALTH_TIMEOUT_MS = 10_000
const HEALTH_POLL_MS = 250
const HEALTH_REQUEST_TIMEOUT_MS = 1000
const REQUEST_TIMEOUT_MS = 180_000

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

function routeWithTime(route: string): string {
  return `${route}?time=${Date.now()}`
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

  const startResponse = await request(
    'POST',
    options.port,
    routeWithTime('/start')
  )

  if (startResponse.statusCode !== 200) {
    throw new Error(
      `/start returned ${startResponse.statusCode}: ${startResponse.body}`
    )
  }

  logger.info(
    `Telemetry collector is healthy with pid ${child.pid ?? 'unknown'}`
  )
}

// Parse the `contexts` input (a JSON blob the caller builds from `${{
// toJson(github) }}` etc.). Contexts can't be read from env by a JS action, so
// this passthrough is the only way to capture github, strategy, matrix, needs,
// and inputs. Invalid JSON is logged and dropped rather than failing the export.
function parseContexts(raw: string): JsonValue | null {
  const trimmed = raw.trim()

  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as JsonValue
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Ignoring contexts input: not valid JSON (${message})`)
    return null
  }
}

// The export is split across three sibling files in one artifact so consumers
// can grab just what they need. Names are derived from the configured output
// path: telemetry.json -> telemetry.system.json + telemetry.contexts.json.
export interface TelemetryFiles {
  readonly telemetry: string
  readonly system: string
  readonly contexts: string
}

export function telemetryFiles(outputPath: string): TelemetryFiles {
  const resolved = path.resolve(outputPath)
  const dir = path.dirname(resolved)
  const ext = path.extname(resolved) || '.json'
  const base = path.basename(resolved, path.extname(resolved))

  return {
    telemetry: resolved,
    system: path.join(dir, `${base}.system${ext}`),
    contexts: path.join(dir, `${base}.contexts${ext}`)
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export async function exportCollector(options: ExportOptions): Promise<void> {
  logger.info(`Exporting telemetry from ${HOST}:${options.port}`)

  const stopResponse = await request(
    'POST',
    options.port,
    routeWithTime('/stop')
  )

  if (stopResponse.statusCode !== 200) {
    throw new Error(
      `/stop returned ${stopResponse.statusCode}: ${stopResponse.body}`
    )
  }

  const metrics = await parseMetrics(
    await request('GET', options.port, '/metrics')
  )
  const job = await collectJob(options.githubToken)

  if (job) {
    for (const line of formatStepTrace(job)) {
      logger.info(line)
    }
  }

  const telemetry: TelemetryExport = {
    ...metrics,
    job,
    contexts: parseContexts(options.contexts)
  }

  // Split the single in-memory export into three sibling files: time-series
  // (telemetry), host facts (system), and workflow contexts. The main file
  // keeps pointers to its siblings so it stays self-describing.
  const { static: staticData, runner, contexts, ...timeSeries } = telemetry
  const files = telemetryFiles(options.outputPath)

  const systemDoc = {
    schema_version: telemetry.schema_version,
    runner,
    static: staticData
  }

  const telemetryDoc = {
    ...timeSeries,
    system_file: path.basename(files.system),
    contexts_file: contexts === null ? null : path.basename(files.contexts)
  }

  await fs.mkdir(path.dirname(files.telemetry), { recursive: true })
  await writeJson(files.telemetry, telemetryDoc)
  await writeJson(files.system, systemDoc)

  if (contexts !== null) {
    await writeJson(files.contexts, {
      schema_version: telemetry.schema_version,
      contexts
    })
  }

  core.setOutput('telemetry_path', files.telemetry)
  core.setOutput('system_path', files.system)
  core.setOutput('contexts_path', contexts === null ? '' : files.contexts)
  core.setOutput('sample_count', String(telemetry.summary.sample_count))
  core.setOutput('job_id', job ? String(job.id) : '')

  logger.info(
    `Wrote ${telemetry.summary.sample_count} telemetry samples to ${files.telemetry}`
  )
  logger.info(`Wrote system info to ${files.system}`)

  if (contexts !== null) {
    logger.info(`Wrote workflow contexts to ${files.contexts}`)
  }

  try {
    await request('POST', options.port, '/shutdown')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.debug(`Collector shutdown request failed: ${message}`)
  }
}
