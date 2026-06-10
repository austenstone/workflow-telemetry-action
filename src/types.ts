export type CollectorMode = 'start' | 'export'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

export interface TelemetrySource {
  readonly name: 'systeminformation'
  readonly version: string
}

export interface TelemetrySample {
  readonly time: number
  readonly dynamic: JsonValue
}

export interface TelemetryError {
  readonly time: number
  readonly metric: string
  readonly message: string
}

export interface TelemetryStep {
  readonly number: number | null
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly duration_ms: number | null
}

export interface TelemetryJob {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly runner_name: string | null
  readonly runner_group_id: number | null
  readonly runner_group_name: string | null
  readonly labels: string[]
  readonly run_id: number
  readonly run_attempt: number | null
  readonly html_url: string | null
  readonly created_at: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly steps: TelemetryStep[]
}

export interface TelemetrySummary {
  readonly sample_count: number
  readonly cpu_load_avg: number
  readonly cpu_load_max: number
  readonly memory_active_mb_max: number
  readonly network_rx_mb_total: number
  readonly network_tx_mb_total: number
  readonly disk_read_mb_total: number
  readonly disk_write_mb_total: number
}

// Runner identity from GitHub's default env vars. Kept separate from `static`
// (which is verbatim systeminformation output) since these are GitHub-provided
// facts, not host introspection. `environment` (github-hosted vs self-hosted)
// is the only billing-relevant signal that can't be inferred any other way.
// `env` is a curated allowlist of GitHub/runner-identity environment
// variables (RUNNER_*, ImageOS/ImageVersion, GitHub run/repo facts). We do
// NOT dump `process.env` because workflows routinely populate secrets into
// the environment via `env:` blocks, `INPUT_*`, and setup-action tokens, and
// the telemetry artifact is downloadable by anyone with read access to the
// run. Captured once at export, so it has no per-sample cost.
export interface TelemetryRunner {
  readonly environment: string | null
  readonly os: string | null
  readonly arch: string | null
  readonly name: string | null
  readonly env: { readonly [key: string]: string }
}

export interface TelemetryExport {
  readonly schema_version: '4'
  readonly source: TelemetrySource
  readonly started_at: string
  readonly finished_at: string
  readonly frequency_ms: number
  readonly static: JsonValue
  readonly runner: TelemetryRunner
  readonly samples: TelemetrySample[]
  readonly summary: TelemetrySummary
  readonly job: TelemetryJob | null
  // Workflow contexts (github, runner, strategy, matrix, needs, inputs, ...)
  // that a JS action can't read from env. Only populated when the caller pipes
  // them in via the `contexts` input as `${{ toJson(...) }}`. Captured verbatim.
  readonly contexts: JsonValue | null
  readonly errors: TelemetryError[]
}

export interface CollectorOptions {
  readonly port: number
  readonly frequencyMs: number
  readonly metricTimeoutMs: number
}

export interface ExportOptions {
  readonly port: number
  readonly outputPath: string
  readonly githubToken: string
  // Raw JSON string from the `contexts` action input. Parsed at export time.
  // Empty string means no contexts were supplied.
  readonly contexts: string
}
