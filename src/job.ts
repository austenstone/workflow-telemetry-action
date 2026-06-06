import * as github from '@actions/github'
import type { components } from '@octokit/openapi-types'
import * as logger from './logger'
import { TelemetryJob, TelemetryStep } from './types'

const MAX_ATTEMPTS = 10
const RETRY_DELAY_MS = 1000
const PAGE_SIZE = 100

type WorkflowJob = components['schemas']['job']
type WorkflowStep = NonNullable<WorkflowJob['steps']>[number]

async function delay(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}

function durationMs(
  startedAt: string | null,
  completedAt: string | null
): number | null {
  if (!startedAt || !completedAt) {
    return null
  }

  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null
  }

  return Math.max(end - start, 0)
}

function toTelemetryStep(step: WorkflowStep): TelemetryStep {
  const startedAt = step.started_at ?? null
  const completedAt = step.completed_at ?? null

  return {
    number: typeof step.number === 'number' ? step.number : null,
    name: step.name ?? '(unnamed step)',
    status: step.status ?? 'unknown',
    conclusion: step.conclusion ?? null,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs(startedAt, completedAt)
  }
}

export function toTelemetryJob(job: WorkflowJob): TelemetryJob {
  const steps = (job.steps ?? [])
    .map(toTelemetryStep)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))

  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    runner_name: job.runner_name ?? null,
    runner_group_id: job.runner_group_id ?? null,
    runner_group_name: job.runner_group_name ?? null,
    labels: job.labels ?? [],
    run_id: job.run_id,
    run_attempt: job.run_attempt ?? null,
    html_url: job.html_url ?? null,
    created_at: job.created_at ?? null,
    started_at: job.started_at ?? null,
    completed_at: job.completed_at ?? null,
    steps
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return 'n/a'
  }

  if (ms < 1000) {
    return `${ms}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Render the job's steps as an aligned, human-readable trace for the Actions
 * log. Pure and side-effect free so it can be unit tested in isolation.
 */
export function formatStepTrace(job: TelemetryJob): string[] {
  const header = `Step trace for job "${job.name}" (id ${job.id}, attempt ${
    job.run_attempt ?? 1
  })`

  if (job.steps.length === 0) {
    return [header, '  (no steps reported)']
  }

  const numberWidth = Math.max(
    ...job.steps.map(step => String(step.number ?? '?').length)
  )
  const stateWidth = Math.max(
    ...job.steps.map(step => (step.conclusion ?? step.status).length)
  )

  const rows = job.steps.map(step => {
    const number = String(step.number ?? '?').padStart(numberWidth)
    const state = (step.conclusion ?? step.status).padEnd(stateWidth)
    const duration = formatDuration(step.duration_ms).padStart(7)

    return `  #${number}  ${state}  ${duration}  ${step.name}`
  })

  return [header, ...rows]
}

/**
 * Look up the workflow job this action is running inside and capture its
 * metadata and step traces. Returns null when the job cannot be identified or
 * the token lacks `actions: read`.
 */
export async function collectJob(token: string): Promise<TelemetryJob | null> {
  if (!token) {
    logger.debug('No github_token provided; skipping job metadata capture.')
    return null
  }

  const runnerName = process.env.RUNNER_NAME

  if (!runnerName) {
    logger.debug('RUNNER_NAME is not set; skipping job metadata capture.')
    return null
  }

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const runId = github.context.runId
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT

  const matchesCurrent = (job: WorkflowJob): boolean =>
    job.status === 'in_progress' &&
    job.runner_name === runnerName &&
    (!runAttempt || String(job.run_attempt ?? '') === runAttempt)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const jobs = await octokit.paginate(
        octokit.rest.actions.listJobsForWorkflowRun,
        { owner, repo, run_id: runId, per_page: PAGE_SIZE }
      )

      const current = jobs.find(matchesCurrent)

      if (current) {
        logger.debug(
          `Matched current job "${current.name}" (id ${current.id}) on attempt ${
            attempt + 1
          }.`
        )

        return toTelemetryJob(current)
      }
    } catch (error: unknown) {
      const status = (error as { status?: number }).status

      if (status === 403) {
        logger.error(
          'Unable to read workflow job info. ' +
            'Ensure your workflow grants the "actions: read" permission.'
        )
        return null
      }

      const message = error instanceof Error ? error.message : String(error)
      logger.debug(`Job lookup attempt ${attempt + 1} failed: ${message}`)
    }

    await delay(RETRY_DELAY_MS)
  }

  logger.debug(
    `Could not match the current job by runner name "${runnerName}" after ${MAX_ATTEMPTS} attempts.`
  )

  return null
}
