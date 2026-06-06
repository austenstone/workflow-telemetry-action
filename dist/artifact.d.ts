export type IfNoFilesFound = 'warn' | 'error' | 'ignore';
export interface UploadTelemetryOptions {
    readonly filePath: string;
    readonly artifactName: string;
    readonly retentionDays?: number;
    readonly ifNoFilesFound: IfNoFilesFound;
}
/**
 * Upload the exported telemetry JSON as a workflow artifact directly from the
 * action, so callers don't need a separate `actions/upload-artifact` step.
 */
export declare function uploadTelemetryArtifact(options: UploadTelemetryOptions): Promise<void>;
