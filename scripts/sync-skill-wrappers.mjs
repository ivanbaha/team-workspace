#!/usr/bin/env node
/**
 * sync-skill-wrappers.mjs
 *
 * A skill is written once, in .ai/skills/<name>/SKILL.md, and every agent reads
 * it through a thin wrapper at the path that agent already looks in. The wrappers
 * carry no instructions of their own — only the frontmatter the agent needs to
 * discover the skill, and a pointer to the canonical body.
 *
 * That frontmatter is the thing worth generating. Hand-copied, it drifts: before
 * this script existed, one wrapper for the same skill was named "Debug & Report"
 * and another "debug-and-report", and their descriptions had diverged — so the
 * same skill triggered differently depending on which agent you asked.
 *
 * Usage:
 *   node scripts/sync-skill-wrappers.mjs            # write the wrappers
 *   node scripts/sync-skill-wrappers.mjs --check    # exit 1 if any has drifted
 *   yarn skills:sync / yarn skills:check
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, '.ai', 'skills');
const check = process.argv.includes('--check');

/** Minimal frontmatter reader — name and description are all a wrapper needs. */
function readFrontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;

  const fields = {};
  // Values may be quoted and may run long; they never span lines in these files.
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/s, '$1');
  }
  return fields;
}

function discoverSkills() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort();
}

const GENERATED = '<!-- GENERATED FILE — DO NOT EDIT. Run `yarn skills:sync`. -->';

/**
 * One wrapper per agent. Kiro supports a file include, so its wrapper transcludes
 * the canonical body; the others get a pointer the agent follows itself.
 */
const WRAPPERS = [
  {
    dir: '.agents/skills', file: (n) => `${n}/SKILL.md`, agent: 'Antigravity',
    body: (n, fm) => `---
name: ${n}
description: "${fm.description}"
---

${GENERATED}
<!-- Antigravity wrapper — the canonical skill is agent-neutral. -->

The full instructions live in the canonical file. Follow them exactly, from Step 1:

[.ai/skills/${n}/SKILL.md](../../../.ai/skills/${n}/SKILL.md)
`,
  },
  {
    dir: '.kiro/skills', file: (n) => `${n}/SKILL.md`, agent: 'Kiro',
    body: (n, fm) => `---
name: ${n}
description: "${fm.description}"
---

${GENERATED}

#[[file:../../../.ai/skills/${n}/SKILL.md]]
`,
  },
  {
    dir: '.github/skills', file: (n) => `${n}/SKILL.md`, agent: 'GitHub Copilot',
    body: (n, fm) => `---
name: ${n}
description: ${fm.description}
---

${GENERATED}
<!-- GitHub Copilot wrapper — the canonical skill is agent-neutral. -->

Follow the full instructions in \`.ai/skills/${n}/SKILL.md\` exactly, from Step 1.

Connectors live in \`.ai/connectors/\` and run directly with \`node\` — no install step
(Node 18+). Workspace rules are in \`CONTRIBUTING.md\`.
`,
  },
  {
    dir: '.claude/commands', file: (n) => `${n}.md`, agent: 'Claude Code',
    body: (n, fm) => `---
description: ${fm.description}
---

${GENERATED}

# ${n}

The user's initial input (may be empty): $ARGUMENTS

Read and follow the full instructions in \`.ai/skills/${n}/SKILL.md\` from Step 1.

If \`$ARGUMENTS\` is non-empty, treat it as the user's starting input and use it to skip or
shorten the context-gathering questions in Step 1 wherever it already answers them.

Connectors live in \`.ai/connectors/\` and run directly with \`node\` — no install step
(Node 18+). Workspace rules are in \`CONTRIBUTING.md\`.
`,
  },
];

const skills = discoverSkills();
if (skills.length === 0) {
  console.error('ERROR: no skills found under .ai/skills/');
  process.exit(1);
}

let drifted = 0;
let missingFrontmatter = 0;

for (const name of skills) {
  const fm = readFrontmatter(join(SKILLS_DIR, name, 'SKILL.md'));
  if (!fm?.description) {
    console.error(`  SKIP    ${name} — canonical SKILL.md has no frontmatter \`description:\``);
    missingFrontmatter++;
    continue;
  }
  if (fm.name && fm.name !== name) {
    console.error(`  WARN    ${name} — frontmatter name is "${fm.name}"; the directory name wins.`);
  }

  for (const w of WRAPPERS) {
    const rel = join(w.dir, w.file(name));
    const abs = join(ROOT, rel);
    const next = w.body(name, fm);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;

    if (current === next) continue;
    if (check) { drifted++; console.error(`  DRIFTED ${rel}`); continue; }

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, next);
    console.log(`  ${current === null ? 'created' : 'updated'} ${rel}`);
  }
}

if (check) {
  if (drifted || missingFrontmatter) {
    console.error(`\n${drifted} wrapper(s) out of date, ${missingFrontmatter} skill(s) unusable. Run: yarn skills:sync`);
    process.exit(1);
  }
  console.log(`All wrappers in sync for ${skills.length} skill(s): ${skills.join(', ')}`);
} else {
  console.log(`\n${skills.length} skill(s) wrapped for ${WRAPPERS.length} agents: ${skills.join(', ')}`);
}
