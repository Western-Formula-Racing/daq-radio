# Docker Compose Reference

The `installer/docker-compose.yml` file orchestrates the complete DAQ telemetry stack. This document explains how the services fit together, which volumes are persisted, and how to customise the deployment.

## High-level architecture

```text
┌────────────┐
│ File       │
│ uploader   ├──────────────────────────────────▶┌────────────┐
└────────────┘                                   │ TimescaleDB │
                                                  └──────┬─────┘
                                                         │
                                                         ▼
                                             ┌─────────────────────┐
                                             │ Grafana dashboards  │
                                             └─────────────────────┘

Slack bot & code-generator/sandbox connect to TimescaleDB and post
notifications independently of the upload/dashboard path above.
```

All containers join the `datalink` bridge network, enabling them to communicate using Docker hostnames (for example `http://timescaledb:5432`).

## Volumes

| Volume | Mounted by | Purpose |
| --- | --- | --- |
| `timescaledb-data` | `timescaledb` | Persists TimescaleDB metadata and stored telemetry. |
| `grafana-storage` | `grafana` | Stores dashboards, plugins, and Grafana state. |
| `code-generator-chroma` | `code-generator` | Persists the ChromaDB RAG vector store. |
| `code-generator-cache` | `code-generator` | Persists the LLM response/execution result cache. |

Remove volumes with `docker compose down -v` if you need a clean slate.

## Environment file

Docker Compose automatically reads `.env` files located next to `docker-compose.yml`. See [`installer/.env.example`](../installer/.env.example) for the full list of variables. Key values include `POSTGRES_DSN`, `POSTGRES_PASSWORD`, and the optional Slack credentials.

## Conditional services

The Slack bot relies on valid `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` values. Leave them empty (the default) to run the stack without Slack connectivity. All other services start unconditionally.

## Health checks

- `timescaledb` runs a `pg_isready` healthcheck so dependent services (`data-downloader-api`, `sandbox`, `health-monitor`) wait until the database is actually accepting connections before starting.

## Customisation tips

- Override exposed ports in `docker-compose.override.yml` if default host ports conflict with local services.
- Drop in custom dashboards under `installer/grafana/dashboards/`—Grafana auto-imports JSON files at startup.
- Replace `installer/example.dbc` with your team's CAN specification once you're working with real telemetry.

## Useful commands

```bash
# Preview the full resolved configuration
cd installer
docker compose config

# Tail logs for a specific service
docker compose logs -f timescaledb

# Execute a shell inside the TimescaleDB container
docker compose exec timescaledb /bin/sh
```

For detailed service documentation, browse the files under [`docs/containers/`](containers/).