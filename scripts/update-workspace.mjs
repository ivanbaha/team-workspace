#!/usr/bin/env node
/**
 * update-workspace.mjs
 *
 * Reads configs/workspace-repos.json and synchronises every configured repo:
 *   - If the repo directory exists  → git pull (fetch + fast-forward)
 *   - If the repo directory is missing → git clone (same logic as setup-workspace)
 *
 * This script is the single source of truth for keeping nested repos current.
 * It is also triggered automatically by the post-merge git hook after every
 * `git pull` on the workspace root.
 *
 * Usage:
 *   node scripts/update-workspace.mjs
 *   yarn update
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

function exec(cmd, cwd) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd });
    return true;
  } catch {
    return false;
  }
}

function cloneRepo(git, targetDir) {
  log(`  CLONE ${targetDir}`);
  log(`        ${git}`);
  return exec(`git clone ${git} ${targetDir}`);
}

function pullRepo(targetDir) {
  log(`  PULL  ${targetDir}`);
  return exec('git pull --ff-only', targetDir);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
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
  let pulled = 0;
  let failed = 0;

  for (const [category, repos] of categories) {
    log(`\n[${category}]`);

    for (const repo of repos) {
      const { name, git, path: relPath } = repo;

      if (!git || !relPath) {
        log(`  SKIP  ${name ?? '(unnamed)'} — missing "git" or "path" field`);
        continue;
      }

      const targetDir = resolve(ROOT, relPath, name);

      if (existsSync(targetDir)) {
        const ok = pullRepo(targetDir);
        if (ok) {
          log(`  OK    ${name}`);
          pulled++;
        } else {
          log(`  FAIL  ${name} — git pull returned a non-zero exit code`);
          failed++;
        }
      } else {
        const ok = cloneRepo(git, targetDir);
        if (ok) {
          log(`  OK    ${name} (cloned)`);
          cloned++;
        } else {
          log(`  FAIL  ${name} — git clone returned a non-zero exit code`);
          failed++;
        }
      }
    }
  }

  log(`\nDone. Pulled: ${pulled}  Cloned: ${cloned}  Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
