#!/usr/bin/env node
/**
 * update-workspace.mjs
 *
 * Synchronises every repo in configs/workspace-repos.json:
 *   - directory exists  → git pull --ff-only
 *   - directory missing → git clone
 *
 * Called directly (`yarn update`) and by the post-merge / post-rewrite hooks
 * after a pull on the workspace root.
 *
 * This script deliberately does NOT rebuild the docs index. The hook that calls
 * it decides that separately, based on whether documentation markdown actually
 * moved — see .githooks/post-update.mjs. Keeping the two concerns apart is what
 * lets `yarn update` stay a fast, predictable operation.
 *
 * Usage:
 *   node scripts/update-workspace.mjs
 *   yarn update
 */

import { syncRepos, printSummary } from './lib/repo-sync.mjs';

const stats = syncRepos('update');
printSummary(stats);

if (stats.docsChanged) {
  console.log('\nDocs markdown changed. Rebuild the search index with: cd mcp && yarn docs:ingest');
}

if (stats.failed > 0) process.exit(1);
