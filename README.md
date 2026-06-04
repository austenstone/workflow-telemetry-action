# workflow-telemetry-action

Minimal GitHub Action for collecting raw `systeminformation` telemetry from a workflow job as JSON.

No PR comments. No Markdown charts. No job summary rendering. The exported `telemetry.json` is the product.

## Usage

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start telemetry
        uses: austenstone/workflow-telemetry-action@<sha>
        with:
          mode: start
          metric_frequency: "1"

      - run: npm test

      - name: Export telemetry
        uses: austenstone/workflow-telemetry-action@<sha>
        with:
          mode: export
          output_path: telemetry.json

      - uses: actions/upload-artifact@v4
        with:
          name: telemetry
          path: telemetry.json
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `mode` | `start` | `start` launches the local collector. `export` writes telemetry JSON. |
| `output_path` | `telemetry.json` | Path to write telemetry JSON when `mode=export`. |
| `metric_frequency` | `1` | Metric collection frequency in seconds. |
| `server_port` | `7777` | Local collector HTTP server port. |

## Outputs

| Output | Description |
| --- | --- |
| `telemetry_path` | Absolute path to the exported telemetry JSON. |
| `sample_count` | Number of exported telemetry samples. |

## JSON shape

```json
{
  "schema_version": "2",
  "source": {
    "name": "systeminformation",
    "version": "5.21.24"
  },
  "started_at": "2026-06-04T12:00:00.000Z",
  "finished_at": "2026-06-04T12:01:00.000Z",
  "frequency_ms": 1000,
  "static": {
    "...": "raw si.getStaticData() payload"
  },
  "samples": [
    {
      "time": 1780000000000,
      "dynamic": {
        "...": "raw si.getDynamicData('', '*') payload"
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
  "errors": [
    {
      "time": 1780000000000,
      "metric": "getDynamicData",
      "message": "metric collection failed"
    }
  ]
}
```

`static` is collected once with `si.getStaticData()` before the timed sample window starts. Each sample stores the raw `si.getDynamicData('', '*')` payload. `summary` is derived convenience data, and metric collection failures are recorded in `errors` instead of failing `/collect`.

The measured sample window starts after the `mode=start` action has prepared the collector and stops immediately when the `mode=export` action begins. Export writes the samples already collected in between; it does not force an extra export-time dynamic sample.
