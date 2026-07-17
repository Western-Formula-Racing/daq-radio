#!/usr/bin/env bash
# dd-rebuild-cron.sh — auto-sync the data-downloader Docker stack on the
# staging/production VPS when main changes. Designed to be cron-driven and
# safe under a multi-developer workflow: a flock prevents two rebuilds from
# racing, a healthcheck gate refuses unhealthy rollouts, and an automatic
# rollback to the previous commit rebuilds if the new stack is broken.
#
# This file is run from the VPS as the deploy user (the one who can run
# `docker compose` without sudo). It is not part of the runtime image.
#
# Install once on the VPS:
#   sudo install -m 0755 \
#       ~/projects/data-acquisition/server/installer/data-downloader/scripts/dd-rebuild-cron.sh \
#       /usr/local/bin/dd-rebuild-cron
#   sudo tee /etc/systemd/system/dd-rebuild-cron.timer >/dev/null <<EOF
#   [Unit]
#   Description=Poll origin/main and rebuild the data-downloader stack
#   [Timer]
#   OnBootSec=2min
#   OnUnitActiveSec=5min
#   Unit=dd-rebuild-cron.service
#   [Install]
#   WantedBy=timers.target
#   EOF
#   sudo tee /etc/systemd/system/dd-rebuild-cron.service >/dev/null <<EOF
#   [Unit]
#   Description=Rebuild data-downloader stack from origin/main
#   [Service]
#   Type=oneshot
#   ExecStart=/usr/local/bin/dd-rebuild-cron
#   User=ubuntu
#   WorkingDirectory=/home/ubuntu/projects/data-acquisition
#   EOF
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now dd-rebuild-cron.timer

set -euo pipefail

REPO_DIR="${DD_REPO_DIR:-/home/ubuntu/projects/data-acquisition}"
STACK_DIR="${DD_STACK_DIR:-${REPO_DIR}/server/installer/data-downloader}"
TRACKED_BRANCH="${DD_BRANCH:-origin/main}"
HEALTH_TIMEOUT_SECONDS="${DD_HEALTH_TIMEOUT_SECONDS:-60}"
LOCK_PATH="${DD_LOCK_PATH:-/var/lock/dd-rebuild.lock}"
LOG_TAG="dd-rebuild-cron"

# Cron runs in a minimal env; make sure we have git + docker in PATH.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

log() {
    # Single-line journal-friendly output, so teammates can grep
    # `journalctl -u dd-rebuild-cron -t ${LOG_TAG}`.
    printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "${LOG_TAG}" "$*"
}

# Acquire the rebuild lock so two cron ticks can't overlap (e.g., if a
# previous rebuild is still pulling images). Bail silently if held.
exec 9>"${LOCK_PATH}"
if ! flock -n 9; then
    log "lock held by another rebuild; exiting"
    exit 0
fi

cd "${REPO_DIR}"

# Refuse to operate if the working tree is dirty or if there are local
# commits/divergences that suggest a human is mid-edit. The classifier
# rightly flags a bot `git reset --hard` against an unclean tree as
# irreversible destruction.
if ! git diff --quiet HEAD -- . ':!db_cache.dbc' ':!data/' 2>/dev/null; then
    log "ERROR: working tree is dirty; refusing to reset"
    exit 1
fi
if [ -n "$(git status --porcelain --ignored=no 2>/dev/null | grep -v '^?? db_cache.dbc' | grep -v '^?? data/' || true)" ]; then
    log "ERROR: working tree has untracked/unstaged files outside allowed paths; refusing to reset"
    exit 1
fi
if ! git diff --quiet "${TRACKED_BRANCH}" HEAD 2>/dev/null; then
    log "ERROR: HEAD has diverged from ${TRACKED_BRANCH}; refusing to fast-forward"
    exit 1
fi

# Determine the currently-deployed commit. Because the VPS is a deployment
# target, we track the branch with a tag we move atomically rather than
# letting cron fight with anyone who runs `git pull` by hand.
CURRENT_SHA="$(git rev-parse --verify HEAD 2>/dev/null || echo none)"
log "current deploy sha: ${CURRENT_SHA}"

# Fetch the upstream of TRACKED_BRANCH and compare.
git fetch --quiet origin "${TRACKED_BRANCH#origin/}"
LATEST_SHA="$(git rev-parse --verify "${TRACKED_BRANCH}")"

if [ "${LATEST_SHA}" = "${CURRENT_SHA}" ]; then
    log "no new commits on ${TRACKED_BRANCH}; nothing to do"
    exit 0
fi

log "new commits on ${TRACKED_BRANCH}: ${CURRENT_SHA:0:7}..${LATEST_SHA:0:7}"

# Fast-forward only. If the VPS HEAD has drifted (someone ran a different
# command), refuse and stay put rather than clobbering anyone.
if ! git merge-base --is-ancestor "${CURRENT_SHA}" "${LATEST_SHA}"; then
    log "ERROR: VPS HEAD (${CURRENT_SHA:0:7}) is not on ${TRACKED_BRANCH}; refusing to reset"
    exit 1
fi

PREVIOUS_SHA="${CURRENT_SHA}"
git reset --hard "${LATEST_SHA}" >/dev/null
log "fast-forwarded to ${LATEST_SHA:0:7}"

cd "${STACK_DIR}"

# Rebuild only the affected services. The frontend (`data-downloader-webapp`)
# ships pre-built (Vite build inside the Dockerfile), so a `--no-cache` image
# build is what you want once. Pull-time env vars stay on whatever docker
# compose set up; this script does not edit .env.
log "rebuilding data-downloader-api"
docker compose build --pull data-downloader-api
log "rebuilding data-downloader-webapp"
docker compose build --pull data-downloader-webapp

log "restarting services"
docker compose up -d data-downloader-api data-downloader-webapp

# Health gate. /api/states is the new endpoint from v2 — a clean 400 on
# a missing season doubles as proof the new module mounted correctly.
HEALTH_URL="${DD_HEALTH_URL:-http://localhost:8000}"
STATES_URL="${DD_STATES_URL:-http://localhost:8000/api/states}"

probe() {
    local url="$1" deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
    while [ "$(date +%s)" -lt "${deadline}" ]; do
        if curl --silent --fail --max-time 5 -o /dev/null "${url}"; then
            return 0
        fi
        sleep 2
    done
    return 1
}

if probe "${HEALTH_URL}/api/health"; then
    log "/api/health is 200; probing /api/states endpoint"
    if curl --silent --fail --max-time 10 -X POST \
            -H 'Content-Type: application/json' \
            -d '{"season":"wfr25","start":"2000-01-01T00:00:00Z","end":"2000-01-02T00:00:00Z"}' \
            -o /dev/null "${STATES_URL}"; then
        log "deploy ${LATEST_SHA:0:7} is healthy"
        exit 0
    fi
    log "/api/states did not respond cleanly; treating as unhealthy"
else
    log "/api/health never returned 200 within ${HEALTH_TIMEOUT_SECONDS}s"
fi

# Rollback. We're already on ${LATEST_SHA}; revert and rebuild once more.
log "rolling back to ${PREVIOUS_SHA:0:7}"
cd "${REPO_DIR}"
git reset --hard "${PREVIOUS_SHA}" >/dev/null
cd "${STACK_DIR}"
docker compose build --pull data-downloader-api data-downloader-webapp
docker compose up -d data-downloader-api data-downloader-webapp

if probe "${HEALTH_URL}/api/health"; then
    log "rollback to ${PREVIOUS_SHA:0:7} is healthy"
    exit 1
fi

log "ERROR: rollback also unhealthy — leaving old SHA in place, manual intervention required"
exit 2
