# DAQ Installer

This directory contains the Docker Compose deployment used to run the full telemetry pipeline for the Western Formula Racing data acquisition (DAQ) system. It is safe to publish publicly—sensitive credentials are injected at runtime from a local `.env` file and the sample datasets are intentionally anonymised.

## Contents

- `docker-compose.yml` – Orchestrates all runtime containers.
- `.env.example` – Template for environment variables required by the stack.
- Service folders (for example `file-uploader/`, `slackbot/`, `sandbox/`) – Each contains the Docker context and service-specific source code.

## Prerequisites

- Docker Desktop 4.0+ or Docker Engine 24+
- Docker Compose V2 (bundled with recent Docker releases)

## Quick start

1. Copy the environment template and adjust the values for your environment:
   ```bash
   cd installer
   cp .env.example .env
   # Update tokens/passwords before deploying to production
   ```
2. Launch the stack:
   ```bash
   docker compose up -d
   ```
3. Verify the services:
   ```bash
   docker compose ps
   docker compose logs timescaledb | tail
   ```
4. Tear the stack down when you are finished:
   ```bash
   docker compose down -v
   ```

TimescaleDB starts with an empty database; use the file-uploader (`http://localhost:8084`) to import CAN CSV data.

## Environment variables

All secrets and tokens are defined in `.env`. The defaults provided in `.env.example` are development-safe placeholders and **must** be replaced for production deployments.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DBC_FILE_PATH` | Path to the CAN DBC file used by file-uploader and other services | `example.dbc` |
| `POSTGRES_DSN` | DSN used by services to connect to TimescaleDB | `postgresql://wfr:wfr_password@timescaledb:5432/wfr` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Bootstraps the initial admin user | `wfr` / `wfr_password` |
| `GRAFANA_ADMIN_PASSWORD` | Grafana administrator password | `admin` |
| `ENABLE_SLACK` | Gate to disable Slack-specific services | `false` |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | Credentials for the Slack bot (optional) | empty |
| `SLACK_WEBHOOK_URL` | Incoming webhook for notifications (optional) | empty |
| `SLACK_DEFAULT_CHANNEL` | Default Slack channel ID for outbound messages | `C0123456789` |
| `SLACKBOT_LOG_DIR` | Directory for the Slack bot's per-request interaction logs | `/app/logs` |
| `FILE_UPLOADER_WEBHOOK_URL` | Webhook invoked after uploads complete | inherits `SLACK_WEBHOOK_URL` |
| `ANTHROPIC_API_KEY` | API key for the code-generator's LLM (Anthropic-compatible; MiniMax by default) | empty |
| `ANTHROPIC_BASE_URL` | Base URL for the Anthropic-compatible endpoint | `https://api.minimaxi.com/anthropic` |
| `ANTHROPIC_MODEL` | Model name to use | `MiniMax-M3` |
| `MAX_RETRIES` | Maximum retries for failed code execution | `2` |
| `DEFAULT_SEASON_TABLE` | Default season table for telemetry queries | `wfr26` |
| `DEBUG` | Enables verbose logging for selected services | `0` |

> **Security reminder:** Replace every default value when deploying outside of a local development environment. Generate secure tokens with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.

## Service catalogue

| Service | Ports | Description |
| --- | --- | --- |
| `timescaledb` | `5432` | Core time-series database (TimescaleDB on PostgreSQL). |
| `grafana` | `8087` | Visualises telemetry with pre-provisioned dashboards. |
| `data-downloader-api` | `8000` | FastAPI backend for telemetry queries with visual SQL query builder. |
| `data-downloader-frontend` | `3000` | Vite frontend for the data downloader. |
| `data-downloader-scanner` | n/a | Background scanner that indexes available data. |
| `file-uploader` | `8084` | Web UI for uploading CAN CSV archives and streaming them into TimescaleDB. |
| `slackbot` | n/a | Socket-mode Slack bot for notifications and automation (optional). Integrates with code-generator for AI queries. |
| `sandbox` | n/a | Custom Python execution environment for running AI-generated code and TimescaleDB queries. |
| `code-generator` | `3030` (internal) | AI-powered code generation service (MiniMax via an Anthropic-compatible API by default). Generates Python code from natural language. |
| `health-monitor` | n/a | Monitors container health and scanner status. |
| `lap-detector` | `8050` | Dash-based lap analysis web application, disabled by default until GPS hardware is available (`docker compose --profile disabled up lap-detector -d`). |

## Deployment & updates

Most services are deployed **manually**, one at a time: rebuild and recreate only the service you
changed (`docker compose build <svc> && docker compose up -d <svc>`). A merge to `main` does **not**
redeploy them — the running containers keep their old code until a human redeploys.

The one exception is the **data-downloader** (`data-downloader-api/-frontend/-scanner`), which
**auto-deploys**. A systemd timer on the production VPS (`dd-rebuild-cron`) polls `origin/main` every
5 minutes and, on a fast-forward, rebuilds just those three services with `--no-deps` (so it never
touches `timescaledb`), health-gated with automatic rollback. It does `git reset --hard origin/main`,
so it also refreshes the on-disk source for the whole checkout — but it only rebuilds/restarts the
data-downloader containers; every other service still needs a manual redeploy to pick up new code.

See `data-downloader/README.md` → **Production deployment (VPS auto-deploy)** for install/operate
commands, and the `deploy-service-changes` skill for the manual flow.

## Data and DBC files

- `example.dbc` is a minimal CAN database used as the fallback DBC (via `DBC_FILE_PATH`) when no custom DBC is uploaded through the file-uploader UI. Replace it with your team's CAN definition when working with real data.

## Observability

- Grafana dashboards are provisioned automatically from `grafana/dashboards/` and use the datasource in `grafana/provisioning/datasources/`.

## Troubleshooting tips

- **Service fails to connect to TimescaleDB** – Confirm `POSTGRES_DSN`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` in `.env` are correct. Regenerate the volumes with `docker compose down -v` if you rotate credentials.
- **Slack services are optional** – Leave Slack variables empty or set `ENABLE_SLACK=false` to skip starting the bot during development.
- **AI code generation not working** – Ensure `ANTHROPIC_API_KEY` is set in `.env`. Check logs with `docker compose logs code-generator`.
- **Sandbox execution fails** – Verify sandbox container is running with `docker ps | grep sandbox`. Check logs with `docker compose logs sandbox`.

## AI-Powered Code Generation

The stack includes an AI-powered code generation service that allows natural language queries via Slack:

**Usage:**
```
!agent plot battery voltage over the last hour
!agent show me motor temperature correlation with RPM
!agent analyze inverter efficiency
!reply <instructions>   # continue the conversation inside the result thread
!approve                # save the last result as a verified example
!aistats                # code-generator observability dashboard
```

**Features:**
- Automatic code generation from natural language using an Anthropic-compatible LLM (MiniMax-M3 by default)
- RAG context (ChromaDB) over sensor metadata, past runs, and verified golden samples
- Self-correcting retry mechanism (up to 2 retries on failure)
- Multi-turn follow-up conversations via `!reply` (24h/15-turn session limit)
- Secure sandboxed execution environment
- Auto-generation of plots and visualizations
- Direct TimescaleDB access for telemetry queries

**Setup:**
1. Add `ANTHROPIC_API_KEY` to your `.env` file
2. Optional: Configure `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, and `MAX_RETRIES`
3. Services start automatically with the stack

See `sandbox/README.md` for detailed documentation.

## Next steps

- Replace the example dataset and `example.dbc` file with production equivalents once you are ready to ingest real telemetry.
- Update the Grafana dashboards under `grafana/dashboards/` to match your data model.
- Review each service’s README in its respective directory for implementation details.
