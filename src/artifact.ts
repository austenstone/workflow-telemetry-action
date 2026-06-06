import { DefaultArtifactClient } from '@actions/artifact'
import { promises as fs } from 'fs'
import * as path from 'path'
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
 * Upload the exported telemetry JSON as a workflow artifact directly from the
 * action, so callers don't need a separate `actions/upload-artifact` step.
 */
export async function uploadTelemetryArtifact(
  options: UploadTelemetryOptions
): Promise<void> {
  const filePath = path.resolve(options.filePath)

  if (!(await fileExists(filePath))) {
    const message = `No telemetry file found at ${filePath} to upload as "${options.artifactName}"`

    if (options.ifNoFilesFound === 'error') {
      throw new Error(message)
    }

    if (options.ifNoFilesFound === 'warn') {
      logger.warn(message)
    }

    return
  }

  const client = new DefaultArtifactClient()
  const rootDirectory = path.dirname(filePath)

  const { id, size } = await client.uploadArtifact(
    options.artifactName,
    [filePath],
    rootDirectory,
    options.retentionDays ? { retentionDays: options.retentionDays } : {}
  )

  logger.info(
    `Uploaded telemetry artifact "${options.artifactName}" (id ${id ?? 'unknown'}, ${size ?? 0} bytes)`
  )
}
