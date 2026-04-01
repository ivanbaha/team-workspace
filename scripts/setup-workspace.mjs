#!/usr/bin/env node
/**
 * setup-workspace.mjs
 *
 * First-time workspace initialisation:
 *   1. Configures git to use the shared hooks in .githooks/ (installs the
 *      post-merge hook that auto-syncs nested repos after every `git pull`).
 *   2. Reads configs/workspace-repos.json and clones any repo that is not
 *      already present on disk. Existing repos are skipped.
 *
 * For pulling updates on repos that already exist, run `yarn update` instead.
 *
 * Usage:
 *   node scripts/setup-workspace.mjs
 *   yarn setup
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'configs', 'workspace-repos.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(msg + '\n');
}

function exec(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', ...opts });
    return true;
  } catch {
    return false;
  }
}

function cloneRepo(git, targetDir) {
  try {
    execSync(`git clone ${git} ${targetDir}`, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Install git hooks
// ---------------------------------------------------------------------------

function installHooks() {
  log('[1/2] Installing git hooks...');
  const ok = exec('git config core.hooksPath .githooks', { cwd: ROOT });
  if (ok) {
    log('      git hooks path set to .githooks (post-merge hook is now active)');
  } else {
    log('      WARNING: Could not set git hooks path. Run manually:');
    log('               git config core.hooksPath .githooks');
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Clone missing repos
// ---------------------------------------------------------------------------

function cloneMissingRepos() {
  log('\n[2/2] Cloning missing repos...');

  if (!existsSync(CONFIG_PATH)) {
    log(`ERROR: Config file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const categories = Object.entries(config);

  if (categories.length === 0) {
    log('No repos configured. Nothing to do.');
    return;
  }

  let cloned = 0;
  let skipped = 0;
  let failed = 0;

  for (const [category, repos] of categories) {
    log(`\n[${category}]`);

    for (const repo of repos) {
      const { name, git, path: relPath } = repo;

      if (!git || !relPath) {
        log(`  SKIP  ${name ?? '(unnamed)'} — missing "git" or "path" field`);
        skipped++;
        continue;
      }

      const targetDir = resolve(ROOT, relPath, name);

      if (existsSync(targetDir)) {
        log(`  SKIP  ${name} — already exists`);
        skipped++;
        continue;
      }

      log(`  CLONE ${name}`);
      log(`        ${git}`);
      log(`        -> ${targetDir}`);

      const ok = cloneRepo(git, targetDir);

      if (ok) {
        log(`  OK    ${name}`);
        cloned++;
      } else {
        log(`  FAIL  ${name} — git clone returned a non-zero exit code`);
        failed++;
      }
    }
  }

  log(`\nDone. Cloned: ${cloned}  Skipped: ${skipped}  Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

installHooks();
cloneMissingRepos();
