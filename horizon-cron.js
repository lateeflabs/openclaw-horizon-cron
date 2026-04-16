#!/usr/bin/env node

/**
 * OpenClaw Horizon Cron Management CLI
 *
 * Purpose: Horizon Cron Management CLI Tool
 * Delivery Date: April 16, 2026
 *
 * Usage:
 *   horizon-cron help
 *   horizon-cron add <name> "<schedule>" "<command>" [--timezone <tz>] [--priority <0-10>] [--timeout <seconds>]
 *   horizon-cron list [--status <active|paused|all>] [--verbose] [--json]
 *   horizon-cron remove <name> [--confirm]
 *   horizon-cron pause <name>
 *   horizon-cron resume <name>
 *   horizon-cron logs <name> [--limit <n>] [--level <error|warn|info|debug>] [--follow]
 *   horizon-cron status [name]
 *   horizon-cron validate "<cron-expression>"
 *   horizon-cron next <name> [--count <n>]
 *   horizon-cron export [--format <json|yaml>]
 *   horizon-cron import <file>
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw', 'horizon-cron');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const JOBS_FILE = path.join(CONFIG_DIR, 'jobs.json');
const LOGS_DIR = path.join(CONFIG_DIR, 'logs');

// ─── Cron Expression Parser ─────────────────────────────────────────────────
// Supports: standard 5-field (m h dom mon dow), shortcuts (@hourly, @daily, etc.), and intervals (*/n)

const CRON_ALIASES = {
  '@yearly':   '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly':  '0 0 1 * *',
  '@weekly':   '0 0 * * 0',
  '@daily':    '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly':   '0 * * * *',
};

const DAYS_OF_WEEK = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseCronField(field, min, max, aliases = {}) {
  const results = new Set();

  if (field === '*') {
    for (let i = min; i <= max; i++) results.add(i);
    return results;
  }

  for (const part of field.split(',')) {
    let p = part.toLowerCase();
    for (const [alias, val] of Object.entries(aliases)) {
      p = p.replace(alias, String(val));
    }

    if (p.includes('/')) {
      const [range, stepStr] = p.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step < 1) throw new Error(`Invalid step value: ${stepStr}`);

      let rangeMin = min, rangeMax = max;
      if (range !== '*') {
        if (range.includes('-')) {
          [rangeMin, rangeMax] = range.split('-').map(Number);
        } else {
          rangeMin = rangeMax = Number(range);
        }
      }
      for (let i = rangeMin; i <= rangeMax; i += step) {
        results.add(i);
      }
    } else if (p.includes('-')) {
      const [start, end] = p.split('-').map(Number);
      for (let i = start; i <= end; i++) results.add(i);
    } else {
      const val = Number(p);
      if (isNaN(val)) throw new Error(`Invalid value: ${p}`);
      results.add(val);
    }
  }

  for (const v of results) {
    if (v < min || v > max) throw new Error(`Value ${v} out of range [${min}-${max}]`);
  }
  return results;
}

function parseCronExpression(expr) {
  if (typeof expr !== 'string') throw new Error('Cron expression must be a string');

  let normalized = expr.trim();
  if (CRON_ALIASES[normalized]) {
    normalized = CRON_ALIASES[normalized];
  }

  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) throw new Error(`Expected 5 fields, got ${fields.length}: "${expr}"`);

  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours:   parseCronField(fields[1], 0, 23),
    days:    parseCronField(fields[2], 1, 31),
    months:  parseCronField(fields[3], 1, 12, MONTHS),
    weekdays:parseCronField(fields[4], 0, 6, DAYS_OF_WEEK),
  };
}

function matchesCron(schedule, date) {
  return schedule.minutes.has(date.getMinutes())
    && schedule.hours.has(date.getHours())
    && schedule.days.has(date.getDate())
    && schedule.months.has(date.getMonth() + 1)
    && schedule.weekdays.has(date.getDay());
}

function getNextRuns(schedule, count = 1, fromDate = new Date()) {
  const results = [];
  let current = new Date(fromDate);
  current.setSeconds(0, 0);
  current = new Date(current.getTime() + 60000);

  const maxIterations = 4 * 366 * 24 * 60;
  for (let i = 0; i < maxIterations && results.length < count; i++) {
    if (matchesCron(schedule, current)) {
      results.push(new Date(current));
    }
    current = new Date(current.getTime() + 60000);
  }
  return results;
}

// ─── File I/O ───────────────────────────────────────────────────────────────

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function loadJobs() {
  ensureConfigDir();
  if (!fs.existsSync(JOBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch (e) {
    error(`Corrupt jobs file: ${e.message}`);
    return [];
  }
}

function saveJobs(jobs) {
  ensureConfigDir();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2) + '\n');
}

function writeLog(level, message, jobName = null) {
  ensureConfigDir();
  const ts = new Date().toISOString();
  const logLine = JSON.stringify({ ts, level, job: jobName, msg: message }) + '\n';
  const logFile = path.join(LOGS_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFileSync(logFile, logLine);
}

// ─── Output Helpers ─────────────────────────────────────────────────────────

function info(msg) { console.log(msg); writeLog('info', msg); }
function warn(msg) { console.warn(`⚠  ${msg}`); writeLog('warn', msg); }
function error(msg) { console.error(`✗ ${msg}`); writeLog('error', msg); }
function success(msg) { console.log(`✓ ${msg}`); writeLog('info', msg); }

function table(data, headers) {
  if (!data.length) return;
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map(r => String(r[i] ?? '').length)));
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const headerRow = headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join('│');
  const rows = data.map(r => headers.map((_, i) => ` ${String(r[i] ?? '').padEnd(widths[i])} `).join('│'));
  console.log(['┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐',
    '│' + headerRow + '│',
    '├' + sep + '┤',
    ...rows.map(r => '│' + r + '│'),
    '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘'].join('\n'));
}

// ─── Commands ───────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
horizon-cron — OpenClaw Horizon Cron Management CLI

COMMANDS:
  help                                    Show this help message
  add <name> "<schedule>" "<command>"     Add a new cron job
      [--timezone <tz>]                   Timezone (default: America/Chicago)
      [--priority <0-10>]                 Priority 0-10 (default: 5)
      [--timeout <seconds>]               Max execution time (default: 300)
      [--deliver <target>]                Delivery target (e.g. telegram:-100123:4)
      [--source <name>]                   Source name (default: cli)
      [--description <text>]              Human-readable description
  list [--status <active|paused|all>]     List jobs
      [--verbose] [--json]
  remove <name> [--confirm]               Remove a job (requires --confirm)
  pause <name>                            Pause a job
  resume <name>                           Resume a paused job
  logs <name> [--limit <n>]               Show execution logs
      [--level <error|warn|info|debug>]   Filter by log level
      [--follow]                          Tail logs (not yet implemented)
  status [name]                           Show job status and next run
  validate "<expression>"                 Validate a cron expression
  next <name> [--count <n>]               Show next N run times (default: 5)
  export [--format <json|yaml>]           Export all jobs
  import <file>                           Import jobs from file

SCHEDULE FORMATS:
  Standard cron:  "*/5 * * * *"          Every 5 minutes
                  "0 9 * * 1-5"          9 AM weekdays
  Shortcuts:      @hourly, @daily, @midnight, @weekly, @monthly, @yearly

EXAMPLES:
  horizon-cron add ebay-monitor "*/5 * * * *" "node monitor.js" --deliver "telegram:-100123:4"
  horizon-cron list --status active --verbose
  horizon-cron pause ebay-monitor
  horizon-cron next ebay-monitor --count 10
`);
}

function cmdAdd(args) {
  const flags = parseFlags(args);

  if (args._.length < 3) {
    error('Usage: horizon-cron add <name> "<schedule>" "<command>" [options]');
    process.exit(1);
  }

  const [name, schedule, command] = args._;
  const jobs = loadJobs();

  if (jobs.find(j => j.name === name)) {
    error(`Job "${name}" already exists. Use "horizon-cron remove ${name} --confirm" first.`);
    process.exit(1);
  }

  let parsedSchedule;
  try {
    parsedSchedule = parseCronExpression(schedule);
  } catch (e) {
    error(`Invalid cron expression "${schedule}": ${e.message}`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const job = {
    name,
    schedule,
    command,
    timezone: flags.timezone || 'America/Chicago',
    priority: parseInt(flags.priority || '5', 10),
    timeout: parseInt(flags.timeout || '300', 10),
    status: 'active',
    source: flags.source || 'cli',
    description: flags.description || '',
    deliver: flags.deliver || null,
    created: now,
    last_modified: now,
    last_run: null,
    next_run: null,
    run_count: 0,
    error_count: 0,
  };

  const nextRuns = getNextRuns(parsedSchedule, 1);
  if (nextRuns.length) job.next_run = nextRuns[0].toISOString();

  jobs.push(job);
  saveJobs(jobs);
  success(`Added job "${name}" (${schedule})`);

  if (job.next_run) {
    info(`Next run: ${new Date(job.next_run).toLocaleString('en-US', { timeZone: job.timezone })}`);
  }
}

function cmdList(args) {
  const flags = parseFlags(args);
  let jobs = loadJobs();

  const statusFilter = (flags.status || 'active').toLowerCase();
  if (statusFilter !== 'all') {
    jobs = jobs.filter(j => j.status === statusFilter);
  }

  if (flags.json) {
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }

  if (!jobs.length) {
    info(`No jobs found (filter: ${statusFilter}).`);
    return;
  }

  if (flags.verbose) {
    const rows = jobs.map(j => [
      j.name,
      j.schedule,
      j.status,
      j.source || '-',
      j.run_count || 0,
      j.error_count || 0,
      j.next_run ? new Date(j.next_run).toLocaleString('en-US', { timeZone: j.timezone || 'UTC', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-',
      j.deliver || '-',
    ]);
    table(rows, ['NAME', 'SCHEDULE', 'STATUS', 'SOURCE', 'RUNS', 'ERRORS', 'NEXT RUN', 'DELIVER']);
  } else {
    const rows = jobs.map(j => [
      j.name,
      j.schedule,
      j.status,
      j.source || '-',
      j.run_count || 0,
      j.next_run ? new Date(j.next_run).toLocaleString('en-US', { timeZone: j.timezone || 'UTC', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-',
    ]);
    table(rows, ['NAME', 'SCHEDULE', 'STATUS', 'SOURCE', 'RUNS', 'NEXT RUN']);
  }
}

function cmdRemove(args) {
  const flags = parseFlags(args);
  if (!args._.length) { error('Usage: horizon-cron remove <name> [--confirm]'); process.exit(1); }

  const name = args._[0];
  const jobs = loadJobs();
  const idx = jobs.findIndex(j => j.name === name);

  if (idx === -1) { error(`Job "${name}" not found.`); process.exit(1); }

  if (!flags.confirm) {
    warn(`This will permanently remove job "${name}". Re-run with --confirm to proceed.`);
    process.exit(1);
  }

  jobs.splice(idx, 1);
  saveJobs(jobs);
  success(`Removed job "${name}".`);
}

function cmdPause(args) {
  if (!args._.length) { error('Usage: horizon-cron pause <name>'); process.exit(1); }
  const name = args._[0];
  const jobs = loadJobs();
  const job = jobs.find(j => j.name === name);

  if (!job) { error(`Job "${name}" not found.`); process.exit(1); }
  if (job.status === 'paused') { warn(`Job "${name}" is already paused.`); return; }

  job.status = 'paused';
  job.last_modified = new Date().toISOString();
  saveJobs(jobs);
  success(`Paused job "${name}".`);
}

function cmdResume(args) {
  if (!args._.length) { error('Usage: horizon-cron resume <name>'); process.exit(1); }
  const name = args._[0];
  const jobs = loadJobs();
  const job = jobs.find(j => j.name === name);

  if (!job) { error(`Job "${name}" not found.`); process.exit(1); }
  if (job.status === 'active') { warn(`Job "${name}" is already active.`); return; }

  job.status = 'active';
  job.last_modified = new Date().toISOString();

  try {
    const schedule = parseCronExpression(job.schedule);
    const nextRuns = getNextRuns(schedule, 1);
    if (nextRuns.length) job.next_run = nextRuns[0].toISOString();
  } catch (e) { /* ignore */ }

  saveJobs(jobs);
  success(`Resumed job "${name}".`);
  if (job.next_run) {
    info(`Next run: ${new Date(job.next_run).toLocaleString('en-US', { timeZone: job.timezone })}`);
  }
}

function cmdLogs(args) {
  const flags = parseFlags(args);
  if (!args._.length) { error('Usage: horizon-cron logs <name> [--limit <n>] [--level <level>]'); process.exit(1); }

  const name = args._[0];
  const limit = parseInt(flags.limit || '50', 10);
  const levelFilter = flags.level || null;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const logFiles = [
    path.join(LOGS_DIR, `${yesterday}.log`),
    path.join(LOGS_DIR, `${today}.log`),
  ];

  let entries = [];
  for (const lf of logFiles) {
    if (!fs.existsSync(lf)) continue;
    const lines = fs.readFileSync(lf, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.job !== name) continue;
        if (levelFilter && entry.level !== levelFilter) continue;
        entries.push(entry);
      } catch { /* skip malformed lines */ }
    }
  }

  entries = entries.slice(-limit);

  if (!entries.length) {
    info(`No log entries found for job "${name}".`);
    return;
  }

  for (const e of entries) {
    const ts = new Date(e.ts).toLocaleString('en-US', { hour12: false });
    const levelPad = (e.level || 'info').toUpperCase().padEnd(5);
    console.log(`[${ts}] ${levelPad} ${e.msg}`);
  }
}

function cmdStatus(args) {
  const jobs = loadJobs();

  if (args._.length) {
    const name = args._[0];
    const job = jobs.find(j => j.name === name);
    if (!job) { error(`Job "${name}" not found.`); process.exit(1); }

    console.log(`Job:       ${job.name}`);
    console.log(`Schedule:  ${job.schedule}`);
    console.log(`Command:   ${job.command}`);
    console.log(`Status:    ${job.status}`);
    console.log(`Priority:  ${job.priority}`);
    console.log(`Timezone:  ${job.timezone}`);
    console.log(`Source:    ${job.source || 'cli'}`);
    console.log(`Deliver:   ${job.deliver || 'none'}`);
    console.log(`Runs:      ${job.run_count || 0} (${job.error_count || 0} errors)`);
    console.log(`Created:   ${job.created}`);
    if (job.last_run) console.log(`Last Run:  ${new Date(job.last_run).toLocaleString()}`);
    if (job.next_run) {
      console.log(`Next Run:  ${new Date(job.next_run).toLocaleString('en-US', { timeZone: job.timezone })}`);
    }
    if (job.description) console.log(`Notes:     ${job.description}`);
  } else {
    const active = jobs.filter(j => j.status === 'active').length;
    const paused = jobs.filter(j => j.status === 'paused').length;
    const totalRuns = jobs.reduce((s, j) => s + (j.run_count || 0), 0);
    const totalErrors = jobs.reduce((s, j) => s + (j.error_count || 0), 0);

    console.log(`Jobs:      ${jobs.length} total (${active} active, ${paused} paused)`);
    console.log(`Executions: ${totalRuns} runs, ${totalErrors} errors`);
    console.log(`Config:    ${CONFIG_DIR}`);
  }
}

function cmdValidate(args) {
  const expr = args._.join(' ');
  if (!expr) { error('Usage: horizon-cron validate "<cron-expression>"'); process.exit(1); }

  try {
    const schedule = parseCronExpression(expr);
    const nextRuns = getNextRuns(schedule, 5);
    success(`Valid: "${expr}"`);
    console.log('Next 5 runs:');
    for (const run of nextRuns) {
      console.log(`  ${run.toLocaleString('en-US', { timeZone: 'America/Chicago' })}`);
    }
  } catch (e) {
    error(`Invalid: "${expr}" — ${e.message}`);
    process.exit(1);
  }
}

function cmdNext(args) {
  if (!args._.length) { error('Usage: horizon-cron next <name> [--count <n>]'); process.exit(1); }

  const flags = parseFlags(args);
  const name = args._[0];
  const count = parseInt(flags.count || '5', 10);
  const jobs = loadJobs();
  const job = jobs.find(j => j.name === name);

  if (!job) { error(`Job "${name}" not found.`); process.exit(1); }

  try {
    const schedule = parseCronExpression(job.schedule);
    const nextRuns = getNextRuns(schedule, count);
    console.log(`Next ${count} runs for "${name}" (${job.schedule}):`);
    for (const run of nextRuns) {
      console.log(`  ${run.toLocaleString('en-US', { timeZone: job.timezone || 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`);
    }
  } catch (e) {
    error(`Cannot parse schedule "${job.schedule}": ${e.message}`);
  }
}

function cmdExport(args) {
  const flags = parseFlags(args);
  const jobs = loadJobs();

  if (flags.format === 'yaml') {
    for (const j of jobs) {
      console.log(`- name: ${j.name}`);
      for (const [k, v] of Object.entries(j)) {
        if (k === 'name') continue;
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
      console.log();
    }
  } else {
    console.log(JSON.stringify(jobs, null, 2));
  }
}

function cmdImport(args) {
  if (!args._.length) { error('Usage: horizon-cron import <file>'); process.exit(1); }

  const file = args._[0];
  if (!fs.existsSync(file)) { error(`File not found: ${file}`); process.exit(1); }

  let imported;
  try {
    imported = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    error(`Invalid JSON: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(imported)) { error('Import file must contain a JSON array of jobs.'); process.exit(1); }

  const existing = loadJobs();
  const existingNames = new Set(existing.map(j => j.name));
  let added = 0;

  for (const job of imported) {
    if (!job.name || !job.schedule || !job.command) {
      warn(`Skipping invalid job entry (missing name/schedule/command).`);
      continue;
    }
    if (existingNames.has(job.name)) {
      warn(`Skipping "${job.name}" — already exists.`);
      continue;
    }

    try {
      parseCronExpression(job.schedule);
    } catch (e) {
      warn(`Skipping "${job.name}" — invalid schedule: ${e.message}`);
      continue;
    }

    existing.push({
      ...job,
      status: job.status || 'active',
      created: job.created || new Date().toISOString(),
      last_modified: new Date().toISOString(),
      run_count: job.run_count || 0,
      error_count: job.error_count || 0,
    });
    existingNames.add(job.name);
    added++;
  }

  saveJobs(existing);
  success(`Imported ${added} jobs (${imported.length - added} skipped).`);
}

// ─── Argument Parsing ───────────────────────────────────────────────────────

function parseFlags(args) {
  const flags = {};
  const clean = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[++i] : true;
      flags[key] = val;
    } else {
      clean.push(args[i]);
    }
  }
  args._ = clean;
  return flags;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const rawArgs = process.argv.slice(2);
  if (!rawArgs.length) { cmdHelp(); return; }

  const command = rawArgs[0].toLowerCase();
  const rest = rawArgs.slice(1);

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':        cmdHelp(); break;
      case 'add':       cmdAdd(parseFlags(rest)); break;
      case 'list':
      case 'ls':        cmdList(parseFlags(rest)); break;
      case 'remove':
      case 'rm':
      case 'delete':    cmdRemove(parseFlags(rest)); break;
      case 'pause':     cmdPause(parseFlags(rest)); break;
      case 'resume':    cmdResume(parseFlags(rest)); break;
      case 'logs':
      case 'log':       cmdLogs(parseFlags(rest)); break;
      case 'status':
      case 'info':      cmdStatus(parseFlags(rest)); break;
      case 'validate':
      case 'check':     cmdValidate(parseFlags(rest)); break;
      case 'next':
      case 'schedule':  cmdNext(parseFlags(rest)); break;
      case 'export':    cmdExport(parseFlags(rest)); break;
      case 'import':    cmdImport(parseFlags(rest)); break;
      default:
        error(`Unknown command: ${command}`);
        console.log('Run "horizon-cron help" for usage.');
        process.exit(1);
    }
  } catch (e) {
    error(`Unexpected error: ${e.message}`);
    process.exit(1);
  }
}

main();
