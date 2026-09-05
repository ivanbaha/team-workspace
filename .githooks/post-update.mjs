#!/usr/bin/env node
/**
 * Shared implementation behind the `post-merge` and `post-rewrite` git hooks.
 *
 * Runs after a pull brings new commits, and decides — cheaply — whether the
 * docs index needs rebuilding:
 *
 *   1. Nothing changed?                      → exit
 *   2. Dependency manifests moved?           → yarn install
 *   3. Nested repos configured?              → sync them (update-workspace)
 *   4. No documentation markdown changed?    → exit
 *   5. A bulk workspace setup is running?    → let it own the rebuild
 *   6. docs_search off / not installed / Qdrant down? → skip with a hint
 *   7. Otherwise                             → schedule a detached ingest
 *
 * Two invariants:
 *   - A hook NEVER fails the git command that triggered it. Every path exits 0.
 *   - The ingest is DETACHED, so it outlives the `git pull` and the terminal
 *     that ran it. Its only record is `.git/hooks-post-update.log`.
 *
 * Usage (wired by scripts/install-git-hooks.mjs):
 *   node .githooks/post-update.mjs post-merge
 *   node .githooks/post-update.mjs post-rewrite
 *   node .githooks/post-update.mjs --ingest     # detached self-re-invocation
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const GIT_DIR = join(ROOT, '.git');
const LOG_PATH = join(GIT_DIR, 'hooks-post-update.log');
const LOCK_PATH = join(GIT_DIR, 'docs-ingest.lock');
const MCP_ROOT = join(ROOT, 'mcp');
const INGEST_SCRIPT = join(MCP_ROOT, 'scripts', 'ingest-docs.mjs');

/** A lock older than this is assumed to belong to a killed run, not a live one. */
const LOCK_STALE_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Logging — every run appends, because a detached ingest has no other record.
// ---------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stdout.write(`[post-update] ${msg}\n`);
  try {
    appendFileSync(LOG_PATH, line + '\n');
  } catch {
    // A hook must not fail because it could not write its own log.
  }
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * Files touched by the commits this pull brought in.
 *
 * `post-merge` runs after a fast-forward or merge, where ORIG_HEAD is the
 * pre-pull tip. `post-rewrite` runs after a rebase, which also sets ORIG_HEAD.
 * If neither is available (a first clone, a reflog-less repo) we report no
 * changes rather than guessing — the daily guard is the safety net.
 */
function changedFiles() {
  for (const range of ['ORIG_HEAD..HEAD', 'HEAD@{1}..HEAD']) {
    try {
      const out = git(['diff', '--name-only', range]);
      return out ? out.split('\n').filter(Boolean) : [];
    } catch {
      // Try the next range.
    }
  }
  return [];
}

/**
 * Is this a documentation markdown file worth reindexing for?
 *
 * CHANGELOG.md is excluded at any depth: release tooling rewrites changelogs on
 * every pipeline, so without this exclusion roughly every pull would trigger a
 * multi-minute rebuild for content nobody ever searches.
 */
function isDocMarkdown(file) {
  const lower = file.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  if (lower === 'changelog.md' || lower.endsWith('/changelog.md')) return false;
  return true;
}

const isManifest = (f) => /(^|\/)(package\.json|yarn\.lock)$/.test(f);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Reinstall dependencies when a pull moved a manifest, so hooks don't run against a stale tree. */
function ensureDeps(files) {
  if (!files.some(isManifest)) return;
  log('Dependency manifests changed — running yarn install...');
  const res = spawnSync('yarn', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (res.status !== 0) log('WARNING: yarn install failed; continuing anyway.');
}

/**
 * Pull the nested repos listed in configs/workspace-repos.json.
 *
 * WS_SETUP_ACTIVE=1 is exported for the child and inherited by every git
 * process below it, so a nested repo's own hooks know a bulk sync owns the
 * rebuild and must not each schedule their own.
 */
function syncNestedRepos() {
  const script = join(ROOT, 'scripts', 'update-workspace.mjs');
  if (!existsSync(script)) return;
  log('Syncing nested repos...');
  spawnSync(process.execPath, [script], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, WS_SETUP_ACTIVE: '1' },
  });
}

/**
 * Reasons to skip the rebuild that are expected, not errors — each returns a
 * hint the developer can act on rather than a failure they must diagnose.
 */
async function ingestBlockedReason() {
  const envPath = join(ROOT, '.env');
  const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const enabled =
    process.env.DOCS_SEARCH_ENABLED === 'true' || /^\s*DOCS_SEARCH_ENABLED\s*=\s*'?"?true/m.test(env);
  if (!enabled) {
    return 'docs_search is disabled (DOCS_SEARCH_ENABLED is not true in .env) — nothing to rebuild.';
  }

  if (!existsSync(join(MCP_ROOT, 'node_modules'))) {
    return 'mcp/node_modules is missing — run `cd mcp && yarn install` to enable automatic reindexing.';
  }

  const url = (process.env.QDRANT_URL || /QDRANT_URL\s*=\s*'?"?([^'"\n]+)/.exec(env)?.[1] || 'http://127.0.0.1:6333').trim();
  if (!(await isQdrantHealthy(url))) {
    return `Qdrant is not reachable at ${url} — it will be auto-started on the next MCP server start, or run \`cd mcp && yarn qdrant:up\`.`;
  }

  return null;
}

async function isQdrantHealthy(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/healthz`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Lock — one ingest at a time, with a staleness rule.
// ---------------------------------------------------------------------------

/**
 * A lock with no staleness rule is a footgun: one killed ingest and rebuilds
 * are blocked forever, silently. A lock older than LOCK_STALE_MS is discarded.
 */
function acquireLock() {
  try {
    if (existsSync(LOCK_PATH)) {
      const age = Date.now() - Number(readFileSync(LOCK_PATH, 'utf8').split('\n')[1] || 0);
      if (Number.isFinite(age) && age < LOCK_STALE_MS) {
        log(`Another ingest is already running (lock is ${Math.round(age / 1000)}s old) — skipping.`);
        return false;
      }
      log('Found a stale ingest lock (>30m) — assuming the previous run was killed, taking over.');
      rmSync(LOCK_PATH, { force: true });
    }
    writeFileSync(LOCK_PATH, `${process.pid}\n${Date.now()}\n`);
    return true;
  } catch (e) {
    log(`WARNING: could not manage the ingest lock (${e.message}); proceeding without it.`);
    return true;
  }
}

const releaseLock = () => rmSync(LOCK_PATH, { force: true });

// ---------------------------------------------------------------------------
// Detached scheduling
// ---------------------------------------------------------------------------

/**
 * Re-invoke this file with `--ingest`, detached, so the rebuild survives the
 * `git pull` returning and the terminal closing.
 *
 * `detached: true` maps to DETACHED_PROCESS on Windows, so the runner owns no
 * console; the inner spawn therefore needs `windowsHide: true` or Windows
 * allocates a fresh (blank) console window for the ingest, and closing it
 * delivers CTRL_CLOSE_EVENT and kills the run. Windows rejects
 * DETACHED_PROCESS combined with CREATE_NO_WINDOW, so `windowsHide` must be on
 * the INNER spawn only — putting it here breaks detachment outright.
 */
function scheduleIngest() {
  const out = openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--ingest'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  log(`Docs markdown changed — docs index rebuild started in the background (pid ${child.pid}).`);
  log(`         Progress: tail -f ${LOG_PATH}`);
}

/** The detached side: actually run the ingest, holding the lock for its lifetime. */
function runIngest() {
  if (!existsSync(INGEST_SCRIPT)) {
    log(`Ingest script not found at ${INGEST_SCRIPT} — skipping.`);
    return;
  }
  if (!acquireLock()) return;

  log('Starting docs ingest...');
  const started = Date.now();
  try {
    const res = spawnSync(process.execPath, [INGEST_SCRIPT], {
      cwd: MCP_ROOT,
      stdio: 'inherit',
      windowsHide: true,
    });
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (res.status === 0) {
      log(`Docs ingest completed successfully in ${secs}s.`);
    } else if (res.status === 3221225786) {
      // 0xC000013A = STATUS_CONTROL_C_EXIT — the console window was closed.
      log(`Docs ingest was INTERRUPTED after ${secs}s (console closed, exit ${res.status}). Retry: cd mcp && yarn docs:ingest`);
    } else {
      log(`Docs ingest FAILED after ${secs}s (exit ${res.status}). Retry: cd mcp && yarn docs:ingest`);
    }
  } finally {
    releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Entry point — every path exits 0 so git never fails because of a hook.
// ---------------------------------------------------------------------------

async function main() {
  const mode = process.argv[2] || 'post-merge';

  if (mode === '--ingest') {
    runIngest();
    return;
  }

  const files = changedFiles();
  if (files.length === 0) {
    log(`${mode}: no changed files detected — nothing to do.`);
    return;
  }
  log(`${mode}: ${files.length} file(s) changed.`);

  ensureDeps(files);
  syncNestedRepos();

  const docs = files.filter(isDocMarkdown);
  if (docs.length === 0) {
    log('No documentation markdown changed — docs index left as is.');
    return;
  }

  // The daily setup pulls every nested repo and deliberately runs ONE ingest at
  // the end. Without this guard each pull's hook would schedule its own,
  // serialising a dozen rebuilds. An env var inherited through the process tree
  // is the whole coordination protocol — no lock negotiation, no IPC.
  if (process.env.WS_SETUP_ACTIVE === '1') {
    log(`${docs.length} markdown file(s) changed — leaving the rebuild to the running workspace setup.`);
    return;
  }

  const blocked = await ingestBlockedReason();
  if (blocked) {
    log(`${docs.length} markdown file(s) changed, but: ${blocked}`);
    return;
  }

  scheduleIngest();
}

main()
  .catch((err) => log(`WARNING: hook failed (${err.message}); ignoring so git succeeds.`))
  .finally(() => process.exit(0));
