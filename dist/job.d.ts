import type { components } from '@octokit/openapi-types';
import { TelemetryJob } from './types';
type WorkflowJob = components['schemas']['job'];
export declare function toTelemetryJob(job: WorkflowJob): TelemetryJob;
/**
 * Render the job's steps as an aligned, human-readable trace for the Actions
 * log. Pure and side-effect free so it can be unit tested in isolation.
 */
export declare function formatStepTrace(job: TelemetryJob): string[];
/**
 * Look up the workflow job this action is running inside and capture its
 * metadata and step traces. Returns null when the job cannot be identified or
 * the token lacks `actions: read`.
 */
export declare function collectJob(token: string): Promise<TelemetryJob | null>;
export {};
