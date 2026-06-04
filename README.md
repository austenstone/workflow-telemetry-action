# workflow-telemetry-action

Minimal GitHub Action for collecting CPU, memory, network, and disk telemetry from a workflow job as raw JSON.

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
  "schema_version": "1",
  "started_at": "2026-06-04T12:00:00.000Z",
  "finished_at": "2026-06-04T12:01:00.000Z",
  "frequency_ms": 1000,
  "samples": {
    "cpu": [
      {
        "time": 1780000000000,
        "total_load": 12.3,
        "user_load": 8.1,
        "system_load": 4.2
      }
    ],
    "memory": [
      {
        "time": 1780000000000,
        "total_mb": 12345,
        "active_mb": 6789,
        "available_mb": 5555
      }
    ],
    "network": [
      {
        "time": 1780000000000,
        "rx_mb": 1,
        "tx_mb": 2
      }
    ],
    "disk": [
      {
        "time": 1780000000000,
        "read_mb": 10,
        "write_mb": 20
      }
    ],
    "disk_size": [
      {
        "time": 1780000000000,
        "available_mb": 100000,
        "used_mb": 50000
      }
    ]
  },
  "summary": {
    "sample_count": 10,
    "cpu_total_load_avg": 12.3,
    "cpu_total_load_max": 50.1,
    "memory_active_mb_max": 7000,
    "network_rx_mb_total": 20,
    "network_tx_mb_total": 5,
    "disk_read_mb_total": 100,
    "disk_write_mb_total": 200
  }
}
```
