#!/usr/bin/env node
/**
 * sync-agent-rules.mjs
 *
 * Every coding agent reads its instructions from a different conventional path.
 * Rather than maintaining six near-identical files by hand — and discovering
 * three months later that two of them disagree — they are generated here from
 * one template and verified in CI.
 *
 * The canonical rules live in .ai/rules/ and are indexed by CONTRIBUTING.md.
 * The generated files say nothing except "the rules are over there".
 *
 * Usage:
 *   node scripts/sync-agent-rules.mjs            # write the pointer files
 *   node scripts/sync-agent-rules.mjs --check    # exit 1 if any has drifted
 *   yarn rules:sync / yarn rules:check
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const RULES_DIR = join(ROOT, '.ai', 'rules');
const check = process.argv.includes('--check');

// Where each agent looks. `depth` is how many levels down the file sits, so the
// template can build correct relative links from anywhere in the tree.
const TARGETS = [
  { path: 'AGENTS.md', agent: 'any agent following the AGENTS.md convention' },
  { path: 'CLAUDE.md', agent: 'Claude Code' },
  { path: '.agents/AGENTS.md', agent: 'Antigravity' },
  { path: '.github/copilot-instructions.md', agent: 'GitHub Copilot' },
  { path: '.kiro/steering/00-workspace-rules.md', agent: 'Kiro' },
  { path: '.cursor/rules/workspace-rules.md', agent: 'Cursor' },
];

/** Rules discovered from disk, so a new rule file needs no edit here. */
function readRules() {
  const order = [
    'git-workflow.md',
    'code-style.md',
    'environments-and-ownership.md',
    'local-environment.md',
    'docs-index.md',
  ];
  return order
    .filter((f) => existsSync(join(RULES_DIR, f)))
    .map((f) => ({ file: f, title: firstHeading(join(RULES_DIR, f)) }));
}

function firstHeading(file) {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('# '));
  return line ? line.slice(2).trim() : file.replace(/\.md$/, '');
}

/**
 * A link from `fromPath` (repo-relative) to `toPath` (repo-relative).
 * Kept as an explicit relative path so the file works when an agent opens it
 * directly from disk, not only when a Markdown renderer resolves repo roots.
 */
function link(fromPath, toPath) {
  const rel = relative(dirname(join(ROOT, fromPath)), join(ROOT, toPath));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function render(target, rules) {
  const contributing = link(target.path, 'CONTRIBUTING.md');
  const rulesList = rules
    .map((r) => `- [${r.title}](${link(target.path, `.ai/rules/${r.file}`)})`)
    .join('\n');

  return `<!-- GENERATED FILE — DO NOT EDIT. Run \`yarn rules:sync\`. -->
<!-- Source: .ai/rules/ + CONTRIBUTING.md · Target: ${target.agent} -->

# Team Workspace — coding-agent rules

This workspace's conventions are the single source of truth in
**[CONTRIBUTING.md](${contributing})**, which indexes the canonical rules in
\`.ai/rules/\`. **Read them before writing code, running shell commands, or making any
file change.**

${rulesList}

Two of them apply to almost every task and are worth reading first:

- **Never commit, push, or post anything without explicit approval for that specific
  action.** Approval for one does not carry to the next.
- **\`docs_search\` before you \`grep\` or hand-roll a script.** There is very likely
  already a doc or a script for it.

Multi-step jobs — reviewing an MR, cutting a release, fixing a vulnerability — have written
procedures in [\`.ai/skills/\`](${link(target.path, '.ai/skills/README.md')}). Use the one that
fits rather than improvising the steps.

Orientation per area: [frontend](${link(target.path, 'frontend/README.md')}) ·
[backend](${link(target.path, 'backend/README.md')}) ·
[libs](${link(target.path, 'libs/README.md')}) ·
[infra](${link(target.path, 'infra/README.md')}) ·
[docs](${link(target.path, 'docs/README.md')}) ·
[scripts](${link(target.path, 'scripts/README.md')})
`;
}

const rules = readRules();
if (rules.length === 0) {
  console.error('ERROR: no rule files found in .ai/rules/ — refusing to generate empty pointers.');
  process.exit(1);
}

let drifted = 0;
for (const target of TARGETS) {
  const abs = join(ROOT, target.path);
  const next = render(target, rules);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;

  if (current === next) {
    if (!check) console.log(`  ok      ${target.path}`);
    continue;
  }

  if (check) {
    drifted++;
    console.error(`  DRIFTED ${target.path}`);
    continue;
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
  console.log(`  ${current === null ? 'created' : 'updated'} ${target.path}`);
}

if (check) {
  if (drifted > 0) {
    console.error(`\n${drifted} agent rule file(s) out of date. Run: yarn rules:sync`);
    process.exit(1);
  }
  console.log(`All ${TARGETS.length} agent rule files are in sync.`);
} else {
  console.log(`\n${TARGETS.length} agent rule files point at CONTRIBUTING.md (${rules.length} rules indexed).`);
}
