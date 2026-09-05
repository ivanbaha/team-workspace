#!/usr/bin/env node
/**
 * daily-setup-guard.mjs
 *
 * Runs on EVERY folder open (see .vscode/tasks.json) and gates the expensive
 * work to once per calendar day via `.git/last-daily-setup`.
 *
 * The guard exists because the useful trigger — "the first time someone starts
 * work today" — is not an event any tool emits. Folder-open is the closest
 * proxy, and it fires a dozen times a day, so the gate is the whole design.
 *
 * When it does run:
 *   1. Install/repair the git hooks.
 *   2. Pull the workspace (meta) repo, and diff old..new to see whether the
 *      pull itself brought documentation markdown.
 *   3. Run setup-workspace with --pull --docs-if-changed [--external-changed],
 *      which syncs every nested repo and rebuilds the docs index exactly ONCE
 *      at the end, only if something moved.
 *   4. Stamp today's date ONLY on success, so a failure retries on the next
 *      folder open rather than being skipped until tomorrow.
 *
 * Everything is appended to `.git/daily-setup.log` with a `=====` header per
 * run, because this runs unattended and its output would otherwise be lost.
 *
 * Usage:
 *   node scripts/daily-setup-guard.mjs
 *   node scripts/daily-setup-guard.mjs --force   # ignore today's stamp
 *   yarn daily-setup
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasDocMarkdown } from './lib/doc-markdown.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const STAMP_PATH = join(ROOT, '.git', 'last-daily-setup');
const LOG_PATH = join(ROOT, '.git', 'daily-setup.log');

const force = process.argv.includes('--force');
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local-agnostic

function log(msg) {
  process.stdout.write(msg + '\n');
  try {
    appendFileSync(LOG_PATH, msg + '\n');
  } catch {
    // Never fail the folder-open task because a log write failed.
  }
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Already run today? */
function alreadyRanToday() {
  if (force) return false;
  try {
    return existsSync(STAMP_PATH) && readFileSync(STAMP_PATH, 'utf8').trim() === today;
  } catch {
    return false;
  }
}

/**
 * Pull the workspace repo itself and report whether the pull brought docs.
 * A failure here is not fatal — offline is a normal state, and the rest of the
 * setup (nested repos, index freshness) is still worth doing.
 */
function pullMetaRepo() {
  let before = null;
  try {
    before = git(['rev-parse', 'HEAD']);
  } catch {
    log('  Not a git repo (or no commits yet) — skipping the meta-repo pull.');
    return { pulled: false, docsChanged: false };
  }

  log('  Pulling the workspace repo...');
  // WS_SETUP_ACTIVE stops this pull's own post-merge hook from scheduling a
  // second, competing ingest — this flow rebuilds once, at the end.
  const res = spawnSync('git', ['pull', '--ff-only'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, WS_SETUP_ACTIVE: '1' },
  });
  if (res.status !== 0) {
    log('  WARNING: workspace pull failed (offline?) — continuing with local state.');
    return { pulled: false, docsChanged: false };
  }

  const after = git(['rev-parse', 'HEAD']);
  if (before === after) {
    log('  Workspace repo already up to date.');
    return { pulled: true, docsChanged: false };
  }

  const changed = git(['diff', '--name-only', `${before}..${after}`]).split('\n').filter(Boolean);
  const docsChanged = hasDocMarkdown(changed);
  log(`  Workspace repo moved ${before.slice(0, 8)}..${after.slice(0, 8)} — ${changed.length} file(s)${docsChanged ? ', docs markdown among them' : ''}.`);
  return { pulled: true, docsChanged };
}

function runSetup(externalChanged) {
  const args = [join(ROOT, 'scripts', 'setup-workspace.mjs'), '--pull', '--docs-if-changed'];
  if (externalChanged) args.push('--external-changed');

  log(`  Running: node scripts/setup-workspace.mjs ${args.slice(1).join(' ')}`);
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, WS_SETUP_ACTIVE: '1' },
  });
  return res.status === 0;
}

// ---------------------------------------------------------------------------

function main() {
  if (alreadyRanToday()) {
    // Deliberately quiet: this is the common case, several times a day.
    process.stdout.write(`[daily-setup] Already ran today (${today}). Use --force to run anyway.\n`);
    return;
  }

  log('');
  log('='.repeat(72));
  log(`[daily-setup] ${new Date().toISOString()} — first folder open of ${today}`);
  log('='.repeat(72));

  const hooks = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-git-hooks.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (hooks.status !== 0) log('  WARNING: hook installation reported a problem; continuing.');

  const { docsChanged } = pullMetaRepo();
  const ok = runSetup(docsChanged);

  if (ok) {
    try {
      writeFileSync(STAMP_PATH, today);
      log(`[daily-setup] Completed. Stamped ${today}.`);
    } catch (e) {
      log(`[daily-setup] Completed, but could not write the date stamp: ${e.message}`);
    }
  } else {
    // No stamp on failure: retry on the next folder open rather than skipping
    // a broken day entirely.
    log('[daily-setup] Setup reported a failure — NOT stamping today, will retry on next folder open.');
  }
}

try {
  main();
} catch (err) {
  log(`[daily-setup] Unexpected error: ${err.message}`);
} finally {
  // An automatic task must never surface as a red error in the editor.
  process.exit(0);
}
