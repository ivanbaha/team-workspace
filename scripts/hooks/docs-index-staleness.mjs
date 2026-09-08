#!/usr/bin/env node
/**
 * docs-index-staleness.mjs — PostToolUse(Edit|Write|MultiEdit)
 *
 * Says, once per file, that `docs_search` is now stale for something just edited.
 *
 * The failure this prevents is quiet and expensive: the agent edits a doc, then
 * later searches for the very thing it wrote, gets the pre-edit version back, and
 * proceeds confidently on stale content. The index only refreshes on `yarn setup`,
 * on the daily guard, or after a pull that moved documentation — and the agent is
 * not allowed to rebuild it itself (.ai/rules/local-environment.md).
 *
 * So this reports rather than fixes, which is the honest shape for it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, allow, filePathOf, notify, readEvent } from './lib/hook-io.mjs';

const event = readEvent();
const file = filePathOf(event);
if (!file || !file.endsWith('.md')) allow();

/**
 * Is this file in the search corpus?
 *
 * mcp/src/docs/sources.js is the authority, and it exports SOURCES as data — so
 * this checks against the real corpus definition rather than a second copy of the
 * rules that would drift from it. If it cannot be loaded, the hook stays silent:
 * a broken reminder is worse than no reminder.
 */
async function isIndexed(relPath) {
  const sourcesPath = join(ROOT, 'mcp', 'src', 'docs', 'sources.js');
  if (!existsSync(sourcesPath)) return null;

  let SOURCES;
  try {
    ({ SOURCES } = await import(sourcesPath));
  } catch {
    return null;
  }
  if (!Array.isArray(SOURCES)) return null;

  const isReadme = relPath.split('/').pop().toLowerCase() === 'readme.md';

  return SOURCES.some((entry) => {
    if (entry.file) return entry.file === relPath;
    if (!entry.base) return false;
    if (!relPath.startsWith(`${entry.base}/`)) return false;

    const rest = relPath.slice(entry.base.length + 1);
    const dirs = rest.split('/').slice(0, -1);
    if (entry.exclude?.some((ex) => dirs.includes(ex))) return false;
    if (entry.depth !== undefined && dirs.length > entry.depth) return false;
    return entry.match === 'all' || (entry.match === 'readme' && isReadme);
  });
}

const indexed = await isIndexed(file);
if (indexed !== true) allow();

// The ingest state records when the corpus was last rebuilt, not which files it
// holds — so the useful extra detail is how old the index already was. An index
// last built weeks ago is a different situation from one built this morning.
let age = '';
try {
  const state = JSON.parse(readFileSync(join(ROOT, 'mcp', '.docs-index', 'ingest-state.json'), 'utf8'));
  const last = state?.lastSuccessfulIngestAt ? new Date(state.lastSuccessfulIngestAt) : null;
  if (last && !Number.isNaN(last.getTime())) {
    const days = Math.floor((Date.now() - last.getTime()) / 86_400_000);
    age = days <= 0 ? ' The index was last rebuilt today.' : ` The index was last rebuilt ${days} day(s) ago.`;
  }
} catch {
  age = ' No ingest state found — the index may never have been built.';
}

notify(
  `docs_search is now STALE for ${file}.${age}\n` +
  `Do not run \`yarn docs:ingest\` yourself. Mention the staleness in your summary so the\n` +
  `operator can refresh when convenient — and remember that any docs_search result for this\n` +
  `file until then reflects the version before your edit.`,
);
