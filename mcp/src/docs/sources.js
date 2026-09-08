/**
 * Which workspace files feed the hybrid docs index (docs_search).
 *
 * This is a DECLARATIVE corpus definition, deliberately hand-curated rather
 * than "index every .md in the workspace". A workspace with a dozen cloned
 * repos contains a lot of markdown that is not team knowledge — vendored docs,
 * generated changelogs, scaffolding templates — and indiscriminate indexing
 * drowns our own docs in noise.
 *
 * Curate with two questions:
 *   1. Would a teammate ever ask a question this file answers?
 *   2. If it ranks first, is that a good answer or a distraction?
 *
 * Paths are workspace-relative (posix). Inspect the resolved list any time:
 *   cd mcp && yarn docs:sources
 */

import { existsSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';

// Dirs we never descend into, anywhere.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.cache', '.docs-index', '.qdrant-storage', '.next', '.turbo',
]);

/**
 * Corpus definition. Each entry is one of four shapes:
 *   { file }                          — a single markdown file
 *   { base, match: 'all' }            — every *.md under base (recursive)
 *   { base, match: 'readme' }         — every README.md under base (recursive)
 *   { base, match: 'readme', depth }  — README.md limited to `depth` dir levels
 *
 * Any `base` entry also accepts `exclude: ['dirName', ...]` — directory names
 * skipped at any depth beneath that base.
 */

// Shared-backend packages whose READMEs carry context worth retrieving.
// Hand-picked rather than globbed: most packages are thin wrappers whose
// READMEs are one line of install instructions, and they add vocabulary noise
// to BM25 without ever being the right answer.
const COMMON_BACKEND_PACKAGES = [
  'exception-handler',
  'cache-manager',
  'database-access',
  'authorization',
  'translations',
];

export const SOURCES = [
  // ── Primary corpus ────────────────────────────────────────────────────────
  // Everything under docs/ — guides, business flows, architecture — EXCEPT
  // docs/SPECs/ (specifications) and docs/tasks/ (task one-pagers). See the note
  // below on why intent and reality must not share a ranked list.
  { base: 'docs', match: 'all', exclude: ['SPECs', 'tasks'] },

  // ── Deliberately NOT indexed: specs, tasks, and agent skills ─────────────
  //
  // Specs (docs/SPECs/) and task one-pagers (docs/tasks/) describe INTENT — what
  // someone plans to build. The rest of docs/ describes REALITY — what exists.
  // Both in one index is actively harmful, in a way that gets worse as the
  // backlog grows:
  //
  //   1. Duplication. A spec and the doc written after it cover the same
  //      feature in similar words, so a query matches both. The agent spends
  //      context reading two accounts of one thing.
  //   2. Tense collapse. Retrieval has no notion of "planned" vs "shipped". A
  //      spec for an UNIMPLEMENTED feature reads exactly like documentation of
  //      a working one, and the agent answers as though the feature exists.
  //      That is a wrong answer delivered confidently — the failure mode this
  //      whole design exists to avoid.
  //   3. Fact-checking tax. Once burned, you cannot trust any result without
  //      opening it to check whether it is a plan or a description. That
  //      erases the point of a retrieval layer.
  //
  // Specs remain valuable to READ; an agent pointed at docs/SPECs/ finds them
  // directly, knowing what they are — and the skills that need one open it by
  // path rather than searching for it. They just must not compete with reference
  // docs in a ranked list. If you do index them, index them into a SEPARATE
  // collection with a separate tool, so the caller chooses "what is planned?"
  // or "what is true?" — see docs/SPECs/README.md.
  //
  // A delivered spec's durable output is the code, plus whatever it moved into
  // these indexed docs. The spec itself stays as the decision record — the "why
  // we rejected X" that reference documentation never carries well.
  //
  // This is why the docs/ entry above carries exclude: ['SPECs', 'tasks'] rather
  // than specs living outside docs/. Specifications are team knowledge and belong
  // in docs/ next to everything else; the exclusion is a RETRIEVAL decision, not
  // a statement about where the files should live.

  // ── Agent tooling ─────────────────────────────────────────────────────────
  // Connector docs describe real, runnable tooling and its output contract —
  // genuine knowledge, worth retrieving.
  //
  // `skills` and `rules` are excluded, for the same reason. Both are
  // INSTRUCTIONS ADDRESSED TO AN AGENT, not knowledge about the system, and
  // every agent already receives them: skills through its own wrapper
  // (.github/skills, .kiro/skills, .agents/skills, .claude/commands) routing to
  // the canonical body in .ai/skills, and rules through its pointer file
  // (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, …) routing to
  // CONTRIBUTING.md and .ai/rules. They are delivered by the agent runtime, so
  // indexing them adds a second, worse delivery path: procedural text competing
  // with reference docs in a ranked list, matching on the domain words it
  // necessarily contains.
  //
  // The rules are the sharper case of the two. `.ai/rules/environments-and-
  // ownership.md` says what dev/test/prod MEAN; `infra/git-ops/README.md` says
  // what is actually deployed to them. Both answer "how do environments work
  // here" on the same vocabulary, and only one of them is a fact about the
  // system — so a ranked list that can return either is a list that sometimes
  // answers a factual question with a policy.
  { base: '.ai', match: 'all', exclude: ['skills', 'rules'] },

  // ── Service READMEs ───────────────────────────────────────────────────────
  // depth: 1 means a newly cloned service is picked up on the next ingest with
  // no edit to this file, while nested per-module READMEs stay out. Where
  // auto-discovery is safe, use it; where it isn't, enumerate.
  { base: 'frontend', match: 'readme', depth: 1 },
  { base: 'backend', match: 'readme', depth: 1 },
  { base: 'libs', match: 'readme', depth: 1 },

  // Hand-picked shared-backend package READMEs (deeper than depth: 1 above).
  ...COMMON_BACKEND_PACKAGES.map((pkg) => ({
    file: `libs/tw-common-backend/packages/${pkg}/README.md`,
  })),

  // ── Infra & workspace tooling ─────────────────────────────────────────────
  { base: 'infra', match: 'readme' },
  { base: 'configs', match: 'readme' },
  { base: 'scripts', match: 'readme' },

  // ── Individual files ──────────────────────────────────────────────────────
  { file: 'README.md' },      // workspace overview
  { file: 'mcp/README.md' },  // this MCP server
];

const isMarkdown = (name) => name.toLowerCase().endsWith('.md');
const isReadme = (name) => name.toLowerCase() === 'readme.md';

function walk(absDir, { accept, maxDepth = Infinity, exclude }, depth = 0, out = []) {
  if (!existsSync(absDir)) return out;
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (exclude?.has(e.name)) continue;
      if (depth < maxDepth) walk(abs, { accept, maxDepth, exclude }, depth + 1, out);
    } else if (accept(e.name)) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Resolve SOURCES against the workspace root into a de-duplicated, sorted list
 * of { abs, rel } markdown files (rel = workspace-relative posix path).
 *
 * Missing paths are skipped silently: entries may point at repos that this
 * developer has not cloned yet, and a partial corpus is the normal state.
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
    // depth counts directory levels below `base`: depth 1 = base + one level.
    const maxDepth = src.depth ?? Infinity;
    const exclude = src.exclude ? new Set(src.exclude) : null;
    for (const abs of walk(base, { accept, maxDepth, exclude })) found.add(abs);
  }

  return [...found]
    .sort()
    .map((abs) => ({ abs, rel: relative(workspaceRoot, abs).split(sep).join('/') }));
}
