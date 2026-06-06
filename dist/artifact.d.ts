export type IfNoFilesFound = 'warn' | 'error' | 'ignore';
export interface UploadTelemetryOptions {
    readonly filePath: string;
    readonly artifactName: string;
    readonly retentionDays?: number;
    readonly ifNoFilesFound: IfNoFilesFound;
}
/**
 * Upload the exported telemetry as a workflow artifact directly from the
 * action, so callers don't need a separate `actions/upload-artifact` step. The
 * export is split across sibling files (telemetry, system, contexts); all that
 * exist are bundled into the one artifact.
 */
export declare function uploadTelemetryArtifact(options: UploadTelemetryOptions): Promise<void>;
