# Local Stack — Offline Testing Guide

Minimal stack for testing without internet: TimescaleDB, Grafana, and file-uploader only.

> There is no separate `docker-compose.local.yml` in this repo — use `docker-compose.yml` (in `server/installer/`) with an explicit service list to start only the three services below.

## First-time setup (requires internet)

### 1. Pull pre-built images

```bash
cd server/installer
docker compose pull timescaledb grafana
```

This fetches `timescale/timescaledb:latest-pg16` and `grafana/grafana` from Docker Hub.
Only needs to be done once, or when you want to update to newer images.

### 2. Build the file-uploader image

```bash
docker compose build file-uploader
```

This compiles the local `file-uploader/` source into an image.
Re-run this if you change code in `file-uploader/`.

### 3. Prepare required files

Make sure this exists in `server/installer/`:

- A `.dbc` file (default: `example.dbc`, or set `DBC_FILE_PATH` in `.env`)

The DBC file is the fallback used when no custom DBC is uploaded via the UI.

---

## Syncing dashboards from production (optional)

User-built dashboards live in Grafana's internal database, not in this repo. Use `backup-dashboards.py` to export them before going offline.

```bash
# Save to a local directory (e.g. a private repo)
python installer/backup-dashboards.py \
    --output ~/daq-internal/grafana-dashboards \
    --git-push
```

Then copy (or symlink) that directory over the provisioned one before starting the stack:

```bash
cp -r ~/daq-internal/grafana-dashboards/* server/installer/grafana/dashboards/
docker compose -f server/installer/docker-compose.yml up timescaledb grafana file-uploader
```

Grafana provisions dashboards from `./grafana/dashboards` (the path baked into `docker-compose.yml`) — there is no `GRAFANA_DASHBOARDS_PATH` env var to point it elsewhere.

**Authentication** — the script reads from `.env` automatically:
- `GRAFANA_API_TOKEN` (preferred — service account token)
- `GRAFANA_ADMIN_PASSWORD` (fallback — basic auth as `admin`)

**Server cron** — to automatically back up and push daily at 2am:
```bash
crontab -e
# Add:
0 2 * * * cd /home/ubuntu/projects/daq-internal && python /home/ubuntu/projects/data-acquisition/server/installer/backup-dashboards.py --output ./grafana-dashboards --git-push >> /var/log/grafana-backup.log 2>&1
```

---

## Starting the stack (offline)

```bash
cd server/installer
docker compose up timescaledb grafana file-uploader
```

| Service       | URL                          |
|---------------|-------------------------------|
| Grafana       | http://localhost:8087        |
| File Uploader | http://localhost:8084        |
| TimescaleDB   | postgresql://localhost:5432  |

Grafana credentials: `admin` / `password` (or `GRAFANA_ADMIN_PASSWORD` from `.env`)

---

## Uploading data

1. Open http://localhost:8084
2. Select a bucket from the dropdown (buckets are auto-listed from TimescaleDB)
3. Optionally select a custom `.dbc` file — if omitted, the server-side DBC is used
4. Drop or click to upload one or more `.csv` files
5. Watch the progress bar — data appears in Grafana as rows are written

---

## No internet checklist

Before going offline, verify:

- [ ] `docker images | grep timescaledb` shows `timescale/timescaledb:latest-pg16`
- [ ] `docker images | grep grafana` shows `grafana/grafana`
- [ ] `docker images | grep file-uploader` shows the local build
- [ ] A `.dbc` file is present (or you plan to upload one per-session via the UI)

---

## Grafana has no plugins offline

`docker-compose.yml` sets `GF_INSTALL_PLUGINS: grafana-clock-panel,grafana-simple-json-datasource`
on the `grafana` service, which Grafana fetches from its plugin catalog at container startup —
this requires internet. There is no offline-only compose variant that omits it, so to start Grafana
fully offline, comment out `GF_INSTALL_PLUGINS` in `docker-compose.yml` before going offline (revert
before going back online so plugin-dependent dashboards keep working).

Dashboards that use those plugins will show "panel plugin not found" errors while it's commented out.
Use built-in panel types (Time series, Stat, Table, etc.) for offline-compatible dashboards.

---

## Updating images (back online)

To pull the latest versions:

```bash
docker compose pull timescaledb grafana
docker compose build file-uploader
```
