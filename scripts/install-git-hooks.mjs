#!/usr/bin/env node
/**
 * install-git-hooks.mjs
 *
 * Points git at the tracked hooks in .githooks/ and verifies they are usable.
 *
 * Tracked hooks (rather than hand-copied .git/hooks/ files) mean the automation
 * ships with the repo: a teammate who clones and runs `yarn setup` gets the
 * same behaviour, and a fix to a hook reaches everyone on their next pull.
 *
 * Idempotent — safe to run on every setup, which is exactly what the daily
 * guard does, so a developer who once ran `git config --unset core.hooksPath`
 * is repaired automatically.
 *
 * Usage:
 *   node scripts/install-git-hooks.mjs
 *   yarn hooks:install
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const HOOKS_DIR = join(ROOT, '.githooks');
const EXPECTED = ['post-merge', 'post-rewrite'];

const log = (msg) => process.stdout.write(msg + '\n');

function main() {
  if (!existsSync(HOOKS_DIR)) {
    log(`ERROR: ${HOOKS_DIR} does not exist. Nothing to install.`);
    process.exit(1);
  }

  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT });
    log('git core.hooksPath -> .githooks');
  } catch (e) {
    log('ERROR: could not set core.hooksPath. Run manually:');
    log('       git config core.hooksPath .githooks');
    log(`       (${e.message})`);
    process.exit(1);
  }

  // Git silently ignores a hook that is not executable — a mode bit lost to a
  // zip download or a Windows checkout turns the whole automation into a no-op
  // with no error anywhere. Repair it rather than reporting it.
  let repaired = 0;
  for (const name of readdirSync(HOOKS_DIR)) {
    const abs = join(HOOKS_DIR, name);
    if (!statSync(abs).isFile()) continue;
    const mode = statSync(abs).mode;
    if ((mode & 0o111) === 0) {
      chmodSync(abs, mode | 0o755);
      repaired++;
    }
  }
  if (repaired > 0) log(`Restored the executable bit on ${repaired} hook file(s).`);

  const missing = EXPECTED.filter((h) => !existsSync(join(HOOKS_DIR, h)));
  if (missing.length > 0) {
    log(`WARNING: expected hook(s) not found in .githooks/: ${missing.join(', ')}`);
  }

  log('');
  log('Active hooks:');
  log('  post-merge    — after `git pull` / `git merge`');
  log('  post-rewrite  — after `git pull --rebase` (post-merge never fires for a rebase)');
  log('');
  log('Both sync nested repos and rebuild the docs index only when docs markdown changed.');
  log(`Hook activity is logged to .git/hooks-post-update.log`);
}

main();
