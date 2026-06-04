export type CollectorMode = 'start' | 'export'

export interface CpuSample {
  readonly time: number
  readonly total_load: number
  readonly user_load: number
  readonly system_load: number
}

export interface MemorySample {
  readonly time: number
  readonly total_mb: number
  readonly active_mb: number
  readonly available_mb: number
}

export interface NetworkSample {
  readonly time: number
  readonly rx_mb: number
  readonly tx_mb: number
}

export interface DiskSample {
  readonly time: number
  readonly read_mb: number
  readonly write_mb: number
}

export interface DiskSizeSample {
  readonly time: number
  readonly available_mb: number
  readonly used_mb: number
}

export interface TelemetrySamples {
  readonly cpu: CpuSample[]
  readonly memory: MemorySample[]
  readonly network: NetworkSample[]
  readonly disk: DiskSample[]
  readonly disk_size: DiskSizeSample[]
}

export interface TelemetrySummary {
  readonly sample_count: number
  readonly cpu_total_load_avg: number
  readonly cpu_total_load_max: number
  readonly memory_active_mb_max: number
  readonly network_rx_mb_total: number
  readonly network_tx_mb_total: number
  readonly disk_read_mb_total: number
  readonly disk_write_mb_total: number
}

export interface TelemetryExport {
  readonly schema_version: '1'
  readonly started_at: string
  readonly finished_at: string
  readonly frequency_ms: number
  readonly samples: TelemetrySamples
  readonly summary: TelemetrySummary
}

export interface CollectorOptions {
  readonly port: number
  readonly frequencyMs: number
}

export interface ExportOptions {
  readonly port: number
  readonly outputPath: string
}
