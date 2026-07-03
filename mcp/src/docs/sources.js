/**
 * Which workspace files feed the hybrid docs index (docs_search).
 *
 * Paths are workspace-relative (posix). Extend SOURCES to add more corpora.
 * Rationale for the current selection lives next to each entry.
 */

import { existsSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';

// Dirs we never descend into, anywhere.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.cache', '.docs-index', '.qdrant-storage', '.next', '.turbo',
]);

/**
 * Corpus definition. Each entry is either:
 *   { file }                          — a single markdown file
 *   { base, match: 'all' }            — every *.md under base (recursive)
 *   { base, match: 'readme' }         — every README.md under base (recursive)
 *   { base, match: 'readme', depth }  — README.md limited to `depth` dir levels
 */

// Specific backend packages whose READMEs we want indexed.
// Hand-pick the packages that carry useful context instead of pulling everything.
const COMMON_BACKEND_PACKAGES = [
  'exception-handler',
  'cache-manager',
  'database-access',
  'authorization',
  'translations',
];

export const SOURCES = [
  // Team docs (guides/, business/, architecture/) — the primary corpus.
  { base: 'docs', match: 'all' },

  // Specs: requirements/design/tasks for features we build.
  { base: '.kiro/specs', match: 'all' },

  // Helper tooling (nested READMEs included, as requested).
  { base: 'helpers', match: 'readme' },

  // Every top-level lib README (depth 1) — auto-picks up new libs. This covers
  // all workspace libs. The deep packages READMEs are added selectively below.
  { base: 'libs', match: 'readme', depth: 1 },

  // Hand-picked backend package READMEs (example mapping).
  ...COMMON_BACKEND_PACKAGES.map((pkg) => ({
    file: `libs/tw-common-backend/packages/${pkg}/README.md`,
  })),

  // Other TW-owned areas with useful top-level docs.
  { base: 'abac', match: 'readme' },
  { base: 'qa', match: 'readme' },
  { base: 'configs', match: 'readme' },

  // Individual files.
  { file: 'README.md' }, // workspace overview
  { file: 'mcp/README.md' }, // this MCP server
  { file: 'infra/git-ops/README.md' }, // deployment/infra entry point
];

const isMarkdown = (name) => name.toLowerCase().endsWith('.md');
const isReadme = (name) => name.toLowerCase() === 'readme.md';

function walk(absDir, { accept, maxDepth = Infinity }, depth = 0, out = []) {
  if (!existsSync(absDir)) return out;
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (depth < maxDepth) walk(abs, { accept, maxDepth }, depth + 1, out);
    } else if (accept(e.name)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Resolve SOURCES against the workspace root into a de-duplicated, sorted list
 * of { abs, rel } markdown files (rel = workspace-relative posix path).
 */
export function collectDocFiles(workspaceRoot) {
  const found = new Set();

  for (const src of SOURCES) {
    if (src.file) {
      const abs = join(workspaceRoot, src.file);
      if (existsSync(abs)) found.add(abs);
      continue;
    }
    const base = join(workspaceRoot, src.base);
    const accept = src.match === 'readme' ? isReadme : isMarkdown;
    // depth is relative to `base`; +? no: depth 1 means base + one level of subdirs.
    const maxDepth = src.depth ?? Infinity;
    for (const abs of walk(base, { accept, maxDepth })) found.add(abs);
  }

  return [...found]
    .sort()
    .map((abs) => ({ abs, rel: relative(workspaceRoot, abs).split(sep).join('/') }));
}
