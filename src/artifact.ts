import { DefaultArtifactClient } from '@actions/artifact'
import { promises as fs } from 'fs'
import * as path from 'path'
import { telemetryFiles } from './collector'
import * as logger from './logger'

export type IfNoFilesFound = 'warn' | 'error' | 'ignore'

export interface UploadTelemetryOptions {
  readonly filePath: string
  readonly artifactName: string
  readonly retentionDays?: number
  readonly ifNoFilesFound: IfNoFilesFound
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Upload the exported telemetry as a workflow artifact directly from the
 * action, so callers don't need a separate `actions/upload-artifact` step. The
 * export is split across sibling files (telemetry, system, contexts); all that
 * exist are bundled into the one artifact.
 */
export async function uploadTelemetryArtifact(
  options: UploadTelemetryOptions
): Promise<void> {
  const files = telemetryFiles(options.filePath)
  const mainFile = files.telemetry

  if (!(await fileExists(mainFile))) {
    const message = `No telemetry file found at ${mainFile} to upload as "${options.artifactName}"`

    if (options.ifNoFilesFound === 'error') {
      throw new Error(message)
    }

    if (options.ifNoFilesFound === 'warn') {
      logger.warn(message)
    }

    return
  }

  const candidates = [files.telemetry, files.system, files.contexts]
  const present: string[] = []

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      present.push(candidate)
    }
  }

  const client = new DefaultArtifactClient()
  const rootDirectory = path.dirname(mainFile)

  const { id, size } = await client.uploadArtifact(
    options.artifactName,
    present,
    rootDirectory,
    options.retentionDays ? { retentionDays: options.retentionDays } : {}
  )

  logger.info(
    `Uploaded telemetry artifact "${options.artifactName}" with ${present.length} file(s) (id ${id ?? 'unknown'}, ${size ?? 0} bytes)`
  )
}
