# Docker Compose Reference

The `installer/docker-compose.yml` file orchestrates the complete DAQ telemetry stack. This document explains how the services fit together, which volumes are persisted, and how to customise the deployment.

## High-level architecture

```text
┌──────────────┐    ┌───────────┐    ┌───────────────────┐
│ File uploader│───▶│           │───▶│ Grafana dashboards │
└──────────────┘    │           │    └───────────────────┘
                     │           │
┌──────────────┐     │           │    ┌───────────────────┐
│ data-downloader   ─┤ TimescaleDB├───▶│ grafana-bridge     │
│ (api/scanner/UI)   │           │    │ (Pecan → Grafana)  │
└──────────────┘     │           │    └───────────────────┘
                     │           │
┌──────────────┐     │           │    ┌───────────────────┐
│ sandbox +    │────▶│           │    │ health-monitor      │
│ code-generator│    └───────────┘    │ (watches containers)│
└──────────────┘                      └───────────────────┘

┌──────────────┐    ┌──────────────┐
│ slackbot     │◀──▶│ code-generator│  (Slack `!agent` commands)
└──────────────┘    └──────────────┘

┌──────────────┐
│ lap-detector │  (disabled by default; opt in via --profile disabled)
└──────────────┘
```

All containers join the `datalink` bridge network, enabling them to communicate using Docker hostnames (for example `http://timescaledb:5432`). The actual service list lives in `installer/docker-compose.yml`; see the [service catalogue in the installer README](../installer/README.md#service-catalogue) for ports and one-line descriptions of each service.

## Volumes

| Volume | Mounted by | Purpose |
| --- | --- | --- |
| `timescaledb-data` | `timescaledb` | Persists TimescaleDB metadata and stored telemetry. |
| `grafana-storage` | `grafana` | Stores dashboards, plugins, and Grafana state. |
| `code-generator-chroma` | `code-generator` | Persists the ChromaDB RAG index used for code generation. |
| `code-generator-cache` | `code-generator` | Persists the diskcache used to avoid re-generating identical requests. |

Remove volumes with `docker compose down -v` if you need a clean slate.

## Environment file

Docker Compose automatically reads `.env` files located next to `docker-compose.yml`. See [`installer/.env.example`](../installer/.env.example) for the full list of variables. Key values include `POSTGRES_DSN`, `POSTGRES_PASSWORD`, and the optional Slack credentials.

## Conditional services

The Slack bot relies on valid `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` values. Leave them empty (the default) to run the stack without Slack connectivity. All other services start unconditionally.

## Health checks

- `timescaledb` runs `pg_isready` against port 5432 to ensure the database is reachable before dependants start (`data-downloader-api` and `health-monitor` wait on `service_healthy`).

## Customisation tips

- Override exposed ports in `docker-compose.override.yml` if default host ports conflict with local services.
- Drop in custom dashboards under `installer/grafana/dashboards/`—Grafana auto-imports JSON files at startup.
- Import real telemetry via the `file-uploader` web UI, and update `example.dbc` (or set `GITHUB_DBC_PATH`) to match your CAN specification.

## Useful commands

```bash
# Preview the full resolved configuration
cd installer
docker compose config

# Tail logs for a specific service
docker compose logs -f code-generator

# Execute a shell inside the TimescaleDB container
docker compose exec timescaledb /bin/sh
```

For detailed service documentation, browse the files under [`docs/containers/`](containers/).