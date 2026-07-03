#!/usr/bin/env node
/**
 * Print the full, resolved list of files that feed the docs_search index.
 * Rules live in src/docs/sources.js; this expands them against the workspace.
 * Run:  yarn docs:sources
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { collectDocFiles } from '../src/docs/sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = process.env.DOCS_RAG_WORKSPACE || join(__dirname, '..', '..');

const files = collectDocFiles(WORKSPACE_ROOT);

// Group by top-level segment for a readable overview.
const groups = new Map();
for (const { rel } of files) {
  const top = rel.split('/')[0];
  groups.set(top, (groups.get(top) || []).concat(rel));
}

for (const [top, list] of [...groups].sort()) {
  console.log(`\n${top}/  (${list.length})`);
  for (const rel of list) console.log(`  ${rel}`);
}

console.log(`\nTotal: ${files.length} files from ${groups.size} top-level areas`);
