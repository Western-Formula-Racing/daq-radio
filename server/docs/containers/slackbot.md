# Slackbot

The Slack bot listens in Socket Mode and delivers notifications about data imports, telemetry status, and manual commands.

## Requirements

- `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` must be set in `.env`.
- Ensure Socket Mode is enabled in your Slack app configuration.

## Behavior

- Sends webhook notifications when file uploads complete.
- Provides command handlers defined in `installer/slackbot/slack_bot.py`: `!help`, `!wx`, `!location`, `!testimage`, `!agent`/`!agent-debug` (AI code generation via the code-generator service), `!reply` (threaded follow-ups, 24h/15-turn session limit), `!approve`, `!aistats`, and `!stats`. See `installer/slackbot/README.md` for the full command reference.
- Reads the optional `SLACK_DEFAULT_CHANNEL` to determine where to post updates.
- Logs each `!agent` interaction under `SLACKBOT_LOG_DIR` (defaults to `/app/logs`).

## Development tips

- Run `docker compose logs -f slackbot` to see Socket Mode connection status.
- Use `docker compose exec slackbot python slack_bot.py` for interactive debugging.
- Leave Slack credentials blank to skip starting the service in development.
