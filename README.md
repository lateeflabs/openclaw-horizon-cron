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

## Configuration

Jobs and logs are stored in `~/.openclaw/horizon-cron/`.
