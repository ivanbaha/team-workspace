/**
 * Shared clone/pull logic for the nested repos listed in
 * configs/workspace-repos.json.
 *
 * Used by both `yarn setup` (clone what is missing) and `yarn update` (pull
 * what exists). Beyond keeping the two in step, this reports whether any repo
 * actually moved documentation markdown — the signal the change-aware docs
 * rebuild is gated on.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasDocMarkdown } from './doc-markdown.mjs';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const CONFIG_PATH = join(ROOT, 'configs', 'workspace-repos.json');

const log = (msg) => process.stdout.write(msg + '\n');

export function readRepoConfig() {
  if (!existsSync(CONFIG_PATH)) {
    log(`ERROR: Config file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  // Keys starting with `$` are documentation ($comment), not repo categories.
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('$')));
}

/**
 * Is this entry still pointing at the example's placeholder org?
 *
 * A workspace template ships with a repo list nobody has filled in yet. Trying
 * to clone those and failing makes a brand-new checkout look broken, which is a
 * terrible first impression for a tool whose whole job is to reduce setup
 * friction. Placeholders are skipped with an instruction instead.
 */
export const isPlaceholderRemote = (git) => /(^|[:/])your-org\//.test(git);

function headSha(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function changedBetween(dir, oldSha, newSha) {
  if (!oldSha || !newSha || oldSha === newSha) return [];
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${oldSha}..${newSha}`], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    // Cannot tell what moved — assume the worst so we do not skip a needed
    // rebuild. Failing toward doing the work is the right bias here: the cost
    // of an unnecessary rebuild is minutes, the cost of a missed one is wrong
    // answers until tomorrow.
    return ['unknown.md'];
  }
}

function exec(cmd, cwd) {
  try {
    // WS_SETUP_ACTIVE tells any hook that fires below this point that a bulk
    // sync owns the docs rebuild, so it must not schedule its own.
    execSync(cmd, { stdio: 'inherit', cwd, env: { ...process.env, WS_SETUP_ACTIVE: '1' } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync every configured repo.
 *
 * @param {'setup'|'update'} mode  'setup' clones what is missing and leaves
 *   existing repos untouched; 'update' also pulls the ones already on disk.
 * @returns {{cloned:number, pulled:number, skipped:number, failed:number,
 *            docsChanged:boolean, docsChangedIn:string[]}}
 */
export function syncRepos(mode = 'update') {
  const config = readRepoConfig();
  const categories = Object.entries(config);

  const stats = { cloned: 0, pulled: 0, skipped: 0, failed: 0, placeholders: 0, docsChanged: false, docsChangedIn: [] };

  if (categories.length === 0) {
    log('No repos configured. Nothing to do.');
    return stats;
  }

  for (const [category, repos] of categories) {
    log(`\n[${category}]`);

    for (const repo of repos) {
      const { name, git, path: relPath } = repo;

      if (!git || !relPath) {
        log(`  SKIP  ${name ?? '(unnamed)'} — missing "git" or "path" field`);
        stats.skipped++;
        continue;
      }

      const targetDir = resolve(ROOT, relPath, name);

      if (isPlaceholderRemote(git) && !existsSync(targetDir)) {
        log(`  TODO  ${name} — remote is still the "your-org" placeholder; edit configs/workspace-repos.json`);
        stats.placeholders++;
        continue;
      }

      if (!existsSync(targetDir)) {
        log(`  CLONE ${name}\n        ${git}\n        -> ${targetDir}`);
        if (exec(`git clone ${git} ${targetDir}`)) {
          log(`  OK    ${name} (cloned)`);
          stats.cloned++;
          // A fresh clone always counts: all of its docs are new to the index.
          stats.docsChanged = true;
          stats.docsChangedIn.push(name);
        } else {
          log(`  FAIL  ${name} — git clone returned a non-zero exit code`);
          stats.failed++;
        }
        continue;
      }

      if (mode === 'setup') {
        log(`  SKIP  ${name} — already exists`);
        stats.skipped++;
        continue;
      }

      const before = headSha(targetDir);
      log(`  PULL  ${name}`);
      if (!exec('git pull --ff-only', targetDir)) {
        log(`  FAIL  ${name} — git pull returned a non-zero exit code`);
        stats.failed++;
        continue;
      }
      const after = headSha(targetDir);
      const moved = changedBetween(targetDir, before, after);
      if (hasDocMarkdown(moved)) {
        stats.docsChanged = true;
        stats.docsChangedIn.push(name);
        log(`  OK    ${name} (${moved.length} file(s) changed, docs markdown among them)`);
      } else {
        log(`  OK    ${name}`);
      }
      stats.pulled++;
    }
  }

  return stats;
}

export function printSummary(stats) {
  log(
    `\nDone. Pulled: ${stats.pulled}  Cloned: ${stats.cloned}  Skipped: ${stats.skipped}` +
    `  Placeholders: ${stats.placeholders}  Failed: ${stats.failed}`
  );
  if (stats.placeholders > 0) {
    log(`\n${stats.placeholders} repo(s) still point at the "your-org" placeholder.`);
    log('Edit configs/workspace-repos.json with your real remotes, then re-run.');
  }
  if (stats.docsChangedIn.length > 0) {
    log(`Docs markdown changed in: ${stats.docsChangedIn.join(', ')}`);
  }
}
