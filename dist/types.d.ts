export type CollectorMode = 'start' | 'export';
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export interface TelemetrySource {
    readonly name: 'systeminformation';
    readonly version: string;
}
export interface TelemetrySample {
    readonly time: number;
    readonly dynamic: JsonValue;
}
export interface TelemetryError {
    readonly time: number;
    readonly metric: string;
    readonly message: string;
}
export interface TelemetryStep {
    readonly number: number | null;
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
    readonly started_at: string | null;
    readonly completed_at: string | null;
    readonly duration_ms: number | null;
}
export interface TelemetryJob {
    readonly id: number;
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
    readonly runner_name: string | null;
    readonly runner_group_name: string | null;
    readonly run_id: number;
    readonly run_attempt: number | null;
    readonly html_url: string | null;
    readonly started_at: string | null;
    readonly completed_at: string | null;
    readonly steps: TelemetryStep[];
}
export interface TelemetrySummary {
    readonly sample_count: number;
    readonly cpu_load_avg: number;
    readonly cpu_load_max: number;
    readonly memory_active_mb_max: number;
    readonly network_rx_mb_total: number;
    readonly network_tx_mb_total: number;
    readonly disk_read_mb_total: number;
    readonly disk_write_mb_total: number;
}
export interface TelemetryRunner {
    readonly environment: string | null;
    readonly os: string | null;
    readonly arch: string | null;
    readonly name: string | null;
}
export interface TelemetryExport {
    readonly schema_version: '3';
    readonly source: TelemetrySource;
    readonly started_at: string;
    readonly finished_at: string;
    readonly frequency_ms: number;
    readonly static: JsonValue;
    readonly runner: TelemetryRunner;
    readonly samples: TelemetrySample[];
    readonly summary: TelemetrySummary;
    readonly job: TelemetryJob | null;
    readonly errors: TelemetryError[];
}
export interface CollectorOptions {
    readonly port: number;
    readonly frequencyMs: number;
}
export interface ExportOptions {
    readonly port: number;
    readonly outputPath: string;
    readonly githubToken: string;
}
