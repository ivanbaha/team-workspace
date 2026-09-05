#!/usr/bin/env node
/**
 * setup-workspace.mjs
 *
 * Workspace initialisation, and the once-a-day bulk sync behind the daily guard:
 *   1. Install/repair the git hooks in .githooks/.
 *   2. Clone every repo in configs/workspace-repos.json that is missing, and
 *      (with --pull) pull the ones already on disk.
 *   3. Rebuild the docs index ONCE at the end, if the flags say it is warranted.
 *
 * Step 3 is the reason this script owns the rebuild rather than leaving it to
 * the git hooks: a bulk sync touches ~N repos, and N pull hooks would each
 * schedule their own ingest. WS_SETUP_ACTIVE=1 is exported before any git call
 * and inherited by every child, so those hooks stand down and exactly one
 * rebuild runs here.
 *
 * Flags:
 *   (none)               always rebuild the docs index at the end
 *   --pull               also pull repos that already exist (not just clone missing)
 *   --skip-docs          never rebuild
 *   --docs-if-changed    rebuild only if a pulled/cloned repo moved docs markdown
 *   --external-changed   seed "docs changed = true" (the caller already saw a change)
 *   --docs-dry-run       print the rebuild decision without paying for it
 *
 * Usage:
 *   yarn setup
 *   yarn setup --pull --docs-if-changed
 *   yarn setup --docs-if-changed --docs-dry-run
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, syncRepos, printSummary } from './lib/repo-sync.mjs';
import { decideIngest, runIngest } from './lib/docs-ingest.mjs';

const args = new Set(process.argv.slice(2));
const opts = {
  pull: args.has('--pull'),
  skipDocs: args.has('--skip-docs'),
  ifChanged: args.has('--docs-if-changed'),
  externalChanged: args.has('--external-changed'),
  dryRun: args.has('--docs-dry-run'),
};

const log = (msg) => process.stdout.write(msg + '\n');

// Every git child below this point inherits the flag, so nested hooks know a
// bulk sync owns the docs rebuild. Set before the first git call, not later.
process.env.WS_SETUP_ACTIVE = '1';

// ---------------------------------------------------------------------------
// Step 1 — git hooks
// ---------------------------------------------------------------------------

function installHooks() {
  log('[1/3] Installing git hooks...');
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-git-hooks.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (res.status !== 0) log('      WARNING: hook installation reported a problem; continuing.');
}

// ---------------------------------------------------------------------------
// Step 2 — repos
// ---------------------------------------------------------------------------

function syncStep() {
  log(`\n[2/3] ${opts.pull ? 'Cloning missing and pulling existing repos' : 'Cloning missing repos'}...`);
  const stats = syncRepos(opts.pull ? 'update' : 'setup');
  printSummary(stats);
  return stats;
}

// ---------------------------------------------------------------------------
// Step 3 — docs index
// ---------------------------------------------------------------------------

function docsStep(stats) {
  log('\n[3/3] Docs index...');

  // --external-changed lets the caller (the daily guard, which pulls the meta
  // repo itself before invoking us) fold its own observation into the decision.
  const docsChanged = stats.docsChanged || opts.externalChanged;
  const decision = decideIngest({ ...opts, docsChanged });

  log(`      Decision: ${decision.rebuild ? 'REBUILD' : 'SKIP'} — ${decision.reason}`);
  if (opts.externalChanged) log('      (--external-changed seeded "docs changed = true")');

  if (opts.dryRun) {
    log('      --docs-dry-run: stopping here without rebuilding.');
    return true;
  }
  if (!decision.rebuild) return true;

  const { ok, message } = runIngest();
  log(`      ${message}`);
  // Non-blocking: a stale index is an inconvenience, not a failed setup.
  return ok;
}

// ---------------------------------------------------------------------------

installHooks();
const stats = syncStep();
const docsOk = docsStep(stats);

if (stats.failed > 0) {
  log(`\nSetup finished with ${stats.failed} repo failure(s).`);
  process.exit(1);
}
if (!docsOk) log('\nSetup finished; the docs index rebuild did not complete (see above).');
