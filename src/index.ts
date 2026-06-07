import * as core from '@actions/core'
import { exportCollector, startCollector } from './collector'
import { uploadTelemetryArtifact, IfNoFilesFound } from './artifact'
import * as logger from './logger'
import { startWorkerServer } from './worker'
import { CollectorMode } from './types'

const WORKER_ARG = '--worker'

// State keys shared between the main run and the auto-injected post run.
const STATE_IS_POST = 'isPost'
const STATE_AUTO_UPLOAD = 'autoUpload'
const STATE_PORT = 'port'
const STATE_OUTPUT_PATH = 'outputPath'
const STATE_TOKEN = 'githubToken'
const STATE_CONTEXTS = 'contexts'
const STATE_ARTIFACT_NAME = 'artifactName'
const STATE_RETENTION = 'retentionDays'
const STATE_IF_NO_FILES = 'ifNoFilesFound'

function parsePositiveInteger(value: string, inputName: string): number {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${inputName} must be a positive integer`)
  }

  return parsed
}

function parseNonNegativeInteger(value: string, inputName: string): number {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${inputName} must be a non-negative integer`)
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

function getIfNoFilesFound(): IfNoFilesFound {
  const value = (core.getInput('artifact_if_no_files_found') || 'warn').trim()

  if (value !== 'warn' && value !== 'error' && value !== 'ignore') {
    throw new Error(
      `artifact_if_no_files_found must be "warn", "error", or "ignore", received "${value}"`
    )
  }

  return value
}

async function runStart(port: number, frequencySeconds: number): Promise<void> {
  await startCollector({ port, frequencyMs: frequencySeconds * 1000 })

  // When upload_artifact is enabled, defer export + upload to the post step so
  // callers don't need separate export/upload-artifact steps. Stash everything
  // the post run needs as state.
  const autoUpload = core.getBooleanInput('upload_artifact')
  core.saveState(STATE_IS_POST, 'true')
  core.saveState(STATE_AUTO_UPLOAD, autoUpload ? 'true' : 'false')

  if (autoUpload) {
    core.saveState(STATE_PORT, String(port))
    core.saveState(
      STATE_OUTPUT_PATH,
      core.getInput('output_path') || 'telemetry.json'
    )
    core.saveState(STATE_TOKEN, core.getInput('github_token'))
    core.saveState(STATE_CONTEXTS, core.getInput('contexts'))
    core.saveState(
      STATE_ARTIFACT_NAME,
      core.getInput('artifact_name') || 'telemetry'
    )
    core.saveState(STATE_RETENTION, core.getInput('artifact_retention_days'))
    core.saveState(STATE_IF_NO_FILES, getIfNoFilesFound())
  }
}

async function runPost(): Promise<void> {
  if (core.getState(STATE_AUTO_UPLOAD) !== 'true') {
    // Either upload_artifact was false, or the caller is using an explicit
    // export step. Nothing to do in the post phase.
    return
  }

  const port = parsePositiveInteger(
    core.getState(STATE_PORT) || '7777',
    STATE_PORT
  )
  const outputPath = core.getState(STATE_OUTPUT_PATH) || 'telemetry.json'

  try {
    await exportCollector({
      port,
      outputPath,
      githubToken: core.getState(STATE_TOKEN),
      contexts: core.getState(STATE_CONTEXTS)
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Telemetry export failed in post step: ${message}`)
  }

  const retentionRaw = core.getState(STATE_RETENTION)
  const retentionDays = retentionRaw
    ? parsePositiveInteger(retentionRaw, 'artifact_retention_days')
    : undefined

  try {
    await uploadTelemetryArtifact({
      filePath: outputPath,
      artifactName: core.getState(STATE_ARTIFACT_NAME) || 'telemetry',
      retentionDays,
      ifNoFilesFound:
        (core.getState(STATE_IF_NO_FILES) as IfNoFilesFound) || 'warn'
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Telemetry artifact upload failed in post step: ${message}`)
  }
}

async function runAction(): Promise<void> {
  // The post run reuses this same entrypoint; isPost is only set after a
  // successful start, so its presence reliably distinguishes the phases.
  if (core.getState(STATE_IS_POST) === 'true') {
    await runPost()
    return
  }

  const mode = getMode()
  const port = parsePositiveInteger(
    core.getInput('server_port') || '7777',
    'server_port'
  )
  const frequencySeconds = parseNonNegativeInteger(
    core.getInput('metric_frequency') || '1',
    'metric_frequency'
  )

  if (mode === 'start') {
    await runStart(port, frequencySeconds)
    return
  }

  await exportCollector({
    port,
    outputPath: core.getInput('output_path') || 'telemetry.json',
    githubToken: core.getInput('github_token'),
    contexts: core.getInput('contexts')
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
        frequencyMs: parseNonNegativeInteger(
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
