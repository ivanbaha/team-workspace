#!/usr/bin/env node
/**
 * Nuke and rebuild the docs index from scratch — the §13 recovery procedure as
 * one guarded command.
 *
 * Safe by construction: the index is 100% reproducible from the markdown. There
 * is no state here worth backing up, which is why recovery is always "run the
 * pipeline again" and why the shared deployment needs no snapshots. The only
 * cost of running this is the rebuild time.
 *
 * Deletes:
 *   mcp/.docs-index/      BM25 model + ingest state
 *   mcp/.qdrant-storage/  the Qdrant volume (also clears the stale-directory
 *                         leak that accumulates below the orphan sweeper)
 * Keeps:
 *   mcp/.cache/           the downloaded model weights — re-downloading ~106MB
 *                         is a slow, network-dependent step, and the weights
 *                         are never the thing that is broken.
 *
 * Run:
 *   yarn docs:reset --yes          delete, restart Qdrant, re-ingest
 *   yarn docs:reset --yes --no-ingest   delete and stop (rebuild later)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(MCP_ROOT, '.docs-index');
const STORAGE_DIR = join(MCP_ROOT, '.qdrant-storage');
const ENGINE = (process.env.QDRANT_ENGINE || 'docker').toLowerCase();

const args = new Set(process.argv.slice(2));
const confirmed = args.has('--yes') || args.has('-y');
const doIngest = !args.has('--no-ingest');

function dirSizeMb(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else try { total += statSync(abs).size; } catch { /* raced with deletion */ }
    }
  }
  return total / 1024 / 1024;
}

const targets = [
  ['BM25 model + ingest state', INDEX_DIR],
  ['Qdrant storage volume', STORAGE_DIR],
];

console.log('This will DELETE the local docs index and rebuild it from the markdown.\n');
for (const [label, dir] of targets) {
  const present = existsSync(dir);
  console.log(`  ${present ? 'DELETE' : 'absent'}  ${label}`);
  console.log(`          ${dir}${present ? `  (${dirSizeMb(dir).toFixed(0)} MB)` : ''}`);
}
console.log(`\n  KEEP    model cache (${join(MCP_ROOT, '.cache')}) — no re-download\n`);

if (!confirmed) {
  console.log('Nothing deleted. Re-run with --yes to proceed:');
  console.log('  cd mcp && yarn docs:reset --yes');
  process.exit(0);
}

// Stop the container first: deleting a bind-mounted volume underneath a running
// Qdrant leaves it serving a directory that no longer exists.
console.log(`Stopping Qdrant (${ENGINE})...`);
const stopCmd = ENGINE === 'wslc'
  ? ['wslc', ['container', 'stop', 'workspace-docs-qdrant']]
  : ['docker', ['stop', 'workspace-docs-qdrant']];
spawnSync(stopCmd[0], stopCmd[1], { stdio: 'inherit', shell: true });

for (const [label, dir] of targets) {
  if (!existsSync(dir)) continue;
  rmSync(dir, { recursive: true, force: true });
  console.log(`Deleted ${label}.`);
}

console.log(`\nStarting Qdrant (${ENGINE})...`);
const upScript = ENGINE === 'wslc' ? 'qdrant:up:wslc' : 'qdrant:up';
// The container may still exist with a now-deleted volume; recreate it.
spawnSync(ENGINE === 'wslc' ? 'wslc' : 'docker',
  ENGINE === 'wslc' ? ['container', 'rm', '-f', 'workspace-docs-qdrant'] : ['rm', '-f', 'workspace-docs-qdrant'],
  { stdio: 'ignore', shell: true });
const up = spawnSync('yarn', [upScript], { cwd: MCP_ROOT, stdio: 'inherit', shell: true });
if (up.status !== 0) {
  console.error(`\nCould not start Qdrant. Start it yourself, then run: cd mcp && yarn docs:ingest`);
  process.exit(1);
}

if (!doIngest) {
  console.log('\n--no-ingest: stopping here. Rebuild with: cd mcp && yarn docs:ingest');
  process.exit(0);
}

console.log('\nRebuilding the index (this takes several minutes)...\n');
const ingest = spawnSync(process.execPath, [join(MCP_ROOT, 'scripts', 'ingest-docs.mjs')], {
  cwd: MCP_ROOT,
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(ingest.status ?? 1);
