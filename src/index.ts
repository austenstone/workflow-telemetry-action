import * as core from '@actions/core'
import { exportCollector, startCollector } from './collector'
import * as logger from './logger'
import { startWorkerServer } from './worker'
import { CollectorMode } from './types'

const WORKER_ARG = '--worker'

function parsePositiveInteger(value: string, inputName: string): number {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${inputName} must be a positive integer`)
  }

  return parsed
}

function getMode(): CollectorMode {
  const mode = core.getInput('mode') || 'start'

  if (mode !== 'start' && mode !== 'export') {
    throw new Error(`mode must be "start" or "export", received "${mode}"`)
  }

  return mode
}

async function runAction(): Promise<void> {
  const mode = getMode()
  const port = parsePositiveInteger(
    core.getInput('server_port') || '7777',
    'server_port'
  )
  const frequencySeconds = parsePositiveInteger(
    core.getInput('metric_frequency') || '1',
    'metric_frequency'
  )

  if (mode === 'start') {
    await startCollector({ port, frequencyMs: frequencySeconds * 1000 })
    return
  }

  await exportCollector({
    port,
    outputPath: core.getInput('output_path') || 'telemetry.json'
  })
}

async function run(): Promise<void> {
  try {
    if (process.argv.includes(WORKER_ARG)) {
      await startWorkerServer({
        port: parsePositiveInteger(
          process.env.WORKFLOW_TELEMETRY_SERVER_PORT || '7777',
          'WORKFLOW_TELEMETRY_SERVER_PORT'
        ),
        frequencyMs: parsePositiveInteger(
          process.env.WORKFLOW_TELEMETRY_FREQUENCY_MS || '1000',
          'WORKFLOW_TELEMETRY_FREQUENCY_MS'
        )
      })
      return
    }

    await runAction()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(message)
    core.setFailed(message)
  }
}

void run()
