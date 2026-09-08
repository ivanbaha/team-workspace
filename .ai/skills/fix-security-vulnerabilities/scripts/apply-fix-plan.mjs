#!/usr/bin/env node
/**
 * apply-fix-plan.mjs — write a fix plan into the service.
 *
 *   node .ai/skills/fix-security-vulnerabilities/scripts/apply-fix-plan.mjs \
 *     --plan=.ai/skills/fix-security-vulnerabilities/output/fix-plan.json --dry-run
 *
 *   node .ai/skills/fix-security-vulnerabilities/scripts/apply-fix-plan.mjs \
 *     --plan=.ai/skills/fix-security-vulnerabilities/output/fix-plan.json
 *
 * Touches two files and nothing else:
 *   package.json  — resolutions, and any direct dependency the plan bumps
 *   Dockerfile    — the first `FROM <image>` line, when the plan names a base image
 *
 * It deliberately does NOT install. Writing node_modules in this workspace is an
 * operator action (.ai/rules/local-environment.md), and the install has to be
 * followed by a re-audit anyway — so the script stops at the manifest and prints
 * exactly what to run next.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib/vulns.mjs';

const args = parseArgs();
const dryRun = Boolean(args['dry-run'] ?? args.dryRun);

/** Indentation of an existing JSON file, so rewriting it is a minimal diff. */
function detectIndent(text) {
  const m = text.match(/\n([ \t]+)"/);
  return m ? m[1] : '  ';
}

/** Sorted insert, so the resolutions block does not reshuffle between runs. */
const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

try {
  if (!args.plan) throw new Error('Missing --plan=<path to fix-plan.json>');
  const plan = JSON.parse(readFileSync(args.plan, 'utf8'));
  const dir = plan.serviceDir;
  if (!dir || !existsSync(dir)) throw new Error(`Plan points at a missing serviceDir: ${dir}`);

  const changes = [];

  // ── package.json ─────────────────────────────────────────────────────────
  const pkgPath = join(dir, 'package.json');
  const pkgRaw = readFileSync(pkgPath, 'utf8');
  const indent = detectIndent(pkgRaw);
  const pkg = JSON.parse(pkgRaw);

  const resolutions = plan.resolutions?.set ?? {};
  if (Object.keys(resolutions).length) {
    const before = { ...(pkg.resolutions ?? {}) };
    pkg.resolutions = sortKeys({ ...before, ...resolutions });
    for (const [name, version] of Object.entries(resolutions)) {
      if (before[name] !== version) {
        changes.push({ file: 'package.json', field: 'resolutions', name, from: before[name] ?? null, to: version });
      }
    }
  }

  for (const [field, updates] of [
    ['dependencies', plan.dependencies?.update ?? {}],
    ['devDependencies', plan.devDependencies?.update ?? {}],
  ]) {
    for (const [name, version] of Object.entries(updates)) {
      if (!pkg[field]?.[name]) continue; // not a direct dep here; resolutions cover it
      const from = pkg[field][name];
      // Keep the range operator the manifest already uses (^, ~, or exact) —
      // rewriting "^4.7.8" as "4.7.9" quietly pins a dependency that was
      // deliberately floating, which is a policy change, not a security fix.
      const prefix = from.match(/^[\^~]/)?.[0] ?? '';
      const to = `${prefix}${version}`;
      if (from === to) continue;
      pkg[field][name] = to;
      changes.push({ file: 'package.json', field, name, from, to });
    }
  }

  // ── Dockerfile ───────────────────────────────────────────────────────────
  const baseImage = plan.dockerfile?.baseImage?.set;
  const dockerfilePath = join(dir, 'Dockerfile');
  let dockerfileNext = null;

  if (baseImage) {
    if (!existsSync(dockerfilePath)) {
      console.error(`  ⚠ Plan sets a base image but ${dockerfilePath} does not exist — skipping.`);
    } else {
      const lines = readFileSync(dockerfilePath, 'utf8').split('\n');
      // Only the first FROM that names a real image is rewritten. Later
      // `FROM base AS ...` stages reference that one and inherit the change;
      // rewriting them too would point every stage at the same image and
      // collapse a multi-stage build.
      const idx = lines.findIndex((l) => /^\s*FROM\s+(?!base\b)[^\s]+/i.test(l));
      if (idx === -1) {
        console.error('  ⚠ No FROM line found in the Dockerfile — skipping the base image bump.');
      } else {
        const from = lines[idx].trim();
        lines[idx] = lines[idx].replace(/(^\s*FROM\s+)([^\s]+)/i, `$1${baseImage}`);
        if (lines[idx].trim() !== from) {
          changes.push({ file: 'Dockerfile', field: 'FROM', name: `line ${idx + 1}`, from, to: lines[idx].trim() });
          dockerfileNext = lines.join('\n');
        }
      }
    }
  }

  // ── Report, then write ───────────────────────────────────────────────────
  console.log(`# ${dryRun ? 'DRY RUN — ' : ''}applying fix plan to ${plan.service}\n`);

  if (changes.length === 0) {
    console.log('  Nothing to change — the service already matches the plan.');
    process.exit(0);
  }

  for (const c of changes) {
    console.log(`  ${c.file}  ${c.field}.${c.name}: ${c.from ?? '(new)'} → ${c.to}`);
  }

  if (!dryRun) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + '\n');
    if (dockerfileNext !== null) writeFileSync(dockerfilePath, dockerfileNext);
  }

  console.log(`\n  ${changes.length} change(s) ${dryRun ? 'would be' : ''} written.`);

  if (!dryRun) {
    console.log(`
  Next — these steps are the operator's, not the agent's:

    cd ${dir}
    yarn install                       # or npm install
    node ${new URL('scan-dependencies.mjs', import.meta.url).pathname} --service=${plan.service}

  Expect 0 vulnerabilities. New advisories appearing here is normal and expected:
  clearing a stale resolution lets a previously-pinned transitive dependency float
  back up to a vulnerable version. Add a resolution for each, re-install, re-audit,
  and fold them back into the plan so it stays complete.

  Then run the service's own gates (typecheck, tests) — a bumped dependency that
  passes the audit and fails the build is not a fix.`);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
