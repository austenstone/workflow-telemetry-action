import { CollectorOptions, ExportOptions } from './types';
export declare function startCollector(options: CollectorOptions): Promise<void>;
export interface TelemetryFiles {
    readonly telemetry: string;
    readonly system: string;
    readonly contexts: string;
}
export declare function telemetryFiles(outputPath: string): TelemetryFiles;
export declare function exportCollector(options: ExportOptions): Promise<void>;
