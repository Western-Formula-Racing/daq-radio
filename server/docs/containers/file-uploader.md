# File uploader

The file uploader is a Flask application that streams CAN CSV logs into TimescaleDB. It exposes a simple web UI for selecting the destination **season** (TimescaleDB table within the configured database) and monitoring progress.

## Ports

- Host port **8084** maps to the Flask development server.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `POSTGRES_DSN` | Postgres DSN used for table discovery and writes. | `postgresql://wfr:wfr_password@timescaledb:5432/wfr` |
| `FILE_UPLOADER_WEBHOOK_URL` | Optional webhook invoked when uploads finish. | empty |
| `GITHUB_DBC_TOKEN` | GitHub PAT with repo-read access to download DBC files from a private repo (never sent to the browser). | empty |
| `GITHUB_DBC_REPO` | GitHub repo containing DBC files (e.g. `Western-Formula-Racing/DBC`). | `Western-Formula-Racing/DBC` |
| `GITHUB_DBC_BRANCH` | Branch to fetch DBC files from. | `main` |
| `SLACK_BOT_TOKEN` | Slack bot token for live progress updates (edits a Slack message in-place at 10% increments). | empty |
| `SLACK_DEFAULT_CHANNEL` | Slack channel ID to post progress updates to. | empty |

## Features

- Validates uploaded files (CSV format only).
- Streams rows asynchronously with backpressure to protect the database.
- Decodes frames using `example.dbc`, located alongside the app.
- Posts completion notifications to the configured webhook.

## Usage

1. Visit http://localhost:8084.
2. Choose a target season (table) from the drop-down (populated from the TimescaleDB API).
3. Upload one or more CSV files exported from the vehicle logger.
4. Monitor progress via the live event stream; notifications are sent upon completion if a webhook is configured.
