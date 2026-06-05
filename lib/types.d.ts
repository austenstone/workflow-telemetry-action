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
export interface TelemetryExport {
    readonly schema_version: '2';
    readonly source: TelemetrySource;
    readonly started_at: string;
    readonly finished_at: string;
    readonly frequency_ms: number;
    readonly static: JsonValue;
    readonly samples: TelemetrySample[];
    readonly summary: TelemetrySummary;
    readonly errors: TelemetryError[];
}
export interface CollectorOptions {
    readonly port: number;
    readonly frequencyMs: number;
}
export interface ExportOptions {
    readonly port: number;
    readonly outputPath: string;
}
