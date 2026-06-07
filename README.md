# workflow-telemetry-action

Collect raw `systeminformation` telemetry from a workflow job as JSON. No PR comments, no charts, no job summaries. The JSON is the product.

## Usage

One step. Telemetry exports and uploads automatically in the `post` phase (`post-if: always()`, so it captures even when a later step fails).

```yaml
- uses: actions/checkout@v4

- uses: austenstone/workflow-telemetry-action@<sha>
  with:
    contexts: ${{ toJson(github) }} # optional

- run: npm test
```

### Manual export

Leave `upload_artifact` unset to drive it yourself:

```yaml
- uses: austenstone/workflow-telemetry-action@<sha>
  with:
    mode: start

- run: npm test

- uses: austenstone/workflow-telemetry-action@<sha>
  with:
    mode: export
    output_path: telemetry.json

- uses: actions/upload-artifact@v4
  with:
    name: telemetry
    path: telemetry*.json
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `mode` | `start` | `start` launches the collector. `export` writes the JSON. |
| `output_path` | `telemetry.json` | Where to write the telemetry JSON. |
| `contexts` | `` | JSON of workflow contexts to capture, e.g. `${{ toJson(github) }}`. A JS action can't read these from env. Captured verbatim (may contain secrets). |
| `metric_frequency` | `1` | Sample frequency in seconds. Use `0` to sample continuously, starting the next dynamic metric collection as soon as the previous one completes. |
| `server_port` | `7777` | Local collector HTTP port. |
| `github_token` | `${{ github.token }}` | Reads job metadata + step traces (needs `actions: read`). |
| `upload_artifact` | `true` | Export + upload in the `post` step automatically. |
| `artifact_name` | `telemetry` | Artifact name. |
| `artifact_retention_days` | `` | Retention in days. Empty = repo default. |
| `artifact_if_no_files_found` | `warn` | `warn`, `error`, or `ignore`. |

## Outputs

| Output | Description |
| --- | --- |
| `telemetry_path` | Path to the telemetry JSON. |
| `system_path` | Path to the system info JSON. |
| `contexts_path` | Path to the contexts JSON. Empty if no `contexts` input. |
| `sample_count` | Number of samples. |
| `job_id` | API id of the workflow job. |

## Output files

One artifact, up to three files. Names derive from `output_path`:

- **`telemetry.json`** — time-series: `samples`, `summary`, `job`, `errors`, plus `system_file` / `contexts_file` pointers.
- **`telemetry.system.json`** — `runner` (identity + full env) and `static` (host facts).
- **`telemetry.contexts.json`** — the `contexts` blob. Only written when `contexts` is provided.

```json
{
  "schema_version": "4",
  "source": { "name": "systeminformation", "version": "5.21.24" },
  "started_at": "2026-06-04T12:00:00.000Z",
  "finished_at": "2026-06-04T12:01:00.000Z",
  "frequency_ms": 1000,
  "samples": [
    {
      "time": 1780000000000,
      "dynamic": {
        "time": { "current": 1780000000000 },
        "node": "24.15.0",
        "v8": "13.6.233.17-node.48",
        "currentLoad": { "currentLoad": 12.3 },
        "mem": { "active": 7340032000 },
        "networkStats": [{ "rx_sec": 1048576, "tx_sec": 262144 }],
        "fsStats": { "rx_sec": 5242880, "wx_sec": 10485760 },
        "fsSize": [{ "fs": "/", "used": 123456789 }],
        "disksIO": { "rIO_sec": 10, "wIO_sec": 20 }
      }
    }
  ],
  "summary": {
    "sample_count": 10,
    "cpu_load_avg": 12.3,
    "cpu_load_max": 50.1,
    "memory_active_mb_max": 7000,
    "network_rx_mb_total": 20,
    "network_tx_mb_total": 5,
    "disk_read_mb_total": 100,
    "disk_write_mb_total": 200
  },
  "job": { "...": "GitHub job metadata + step traces" },
  "errors": [],
  "system_file": "telemetry.system.json",
  "contexts_file": "telemetry.contexts.json"
}
```

The sample window starts after `mode=start` finishes preparing the collector and stops when `mode=export` begins. `static` is collected once outside that window; each sample stores a focused dynamic metrics payload from `systeminformation` (`currentLoad`, `mem`, `networkStats`, `fsStats`, `fsSize`, and `disksIO`) plus Node/runtime time fields. `summary` is derived. Metric failures land in `errors` instead of failing collection.
