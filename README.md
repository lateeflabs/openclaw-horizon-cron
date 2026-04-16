# horizon-cron

OpenClaw Horizon Cron Management CLI tool.

## Features

- Add, remove, pause, and resume cron jobs
- Cron expression validation with next-run predictions
- Job status and execution logs
- JSON export/import for backup and migration
- Delivery target support (Telegram, Discord, etc.)

## Installation

```bash
npm install -g .
```

## Usage

```bash
horizon-cron help
horizon-cron add <name> "<schedule>" "<command>" [options]
horizon-cron list [--status active|paused|all] [--verbose]
horizon-cron pause <name>
horizon-cron resume <name>
horizon-cron logs <name> [--limit <n>]
horizon-cron status [name]
horizon-cron validate "<cron-expression>"
horizon-cron next <name> [--count <n>]
horizon-cron export [--format json|yaml]
horizon-cron import <file>
```

## Schedule Formats

- Standard cron: `*/5 * * * *` (every 5 minutes)
- Shortcuts: `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`
- Intervals: `*/15 * * * *` (every 15 minutes)

## Commands

| Command | Description |
|---------|-------------|
| `add` | Add a new cron job with schedule, command, and options |
| `list` | List all jobs with status filtering and verbose output |
| `remove` | Remove a job (requires `--confirm` flag) |
| `pause` | Pause an active job |
| `resume` | Resume a paused job |
| `logs` | View execution logs for a job |
| `status` | Show detailed status for a job or summary of all jobs |
| `validate` | Validate a cron expression and show next 5 runs |
| `next` | Show next N scheduled run times for a job |
| `export` | Export all jobs as JSON or YAML |
| `import` | Import jobs from a JSON file |

## Configuration

Jobs and logs are stored in `~/.openclaw/horizon-cron/`:

- `jobs.json` — all registered jobs
- `logs/YYYY-MM-DD.log` — daily execution logs (JSON lines)
