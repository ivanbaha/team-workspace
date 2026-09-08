#!/usr/bin/env node
/**
 * diff-envs.mjs — what a promotion would carry.
 *
 *   node .ai/skills/release-mr/scripts/diff-envs.mjs --to=test          # from dev
 *   node .ai/skills/release-mr/scripts/diff-envs.mjs --to=prod --json
 *
 * Two independent deltas, reported separately because they are approved
 * separately: the VERSION delta (which services move, and how far) and the
 * CONFIGURATION delta (env keys that exist on the source side but not the target,
 * or hold a different value).
 *
 * The configuration half is the one that causes release-night surprises. A version
 * bump that needs a new env var deploys perfectly and then fails at runtime in the
 * one environment nobody added the key to — so it is surfaced here, before the MR
 * exists, rather than discovered from a crash loop.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  diffConfig, parseArgs, resolveEnvs, versionMap, ENV_SPECIFIC_KEYS,
} from './lib/overlays.mjs';

const args = parseArgs();

/** 1.8.3 -> 1.9.0 is a minor; used only to flag the rows worth a second look. */
function bumpKind(from, to) {
  const a = from.split(/[.\-+]/).map(Number);
  const b = to.split(/[.\-+]/).map(Number);
  if ([a[0], b[0]].some(Number.isNaN)) return 'tag';
  if (b[0] !== a[0]) return b[0] > a[0] ? 'MAJOR' : 'rollback';
  if (b[1] !== a[1]) return b[1] > a[1] ? 'minor' : 'rollback';
  if (b[2] !== a[2]) return b[2] > a[2] ? 'patch' : 'rollback';
  return 'same';
}

try {
  const { from, to } = resolveEnvs(args);
  const src = versionMap(from);
  const dst = versionMap(to);

  const versionDelta = [];
  for (const service of [...new Set([...Object.keys(src), ...Object.keys(dst)])].sort()) {
    const a = dst[service];
    const b = src[service];
    if (b === undefined) { versionDelta.push({ service, from: a, to: null, kind: 'only-in-target' }); continue; }
    if (a === undefined) { versionDelta.push({ service, from: null, to: b, kind: 'new-service' }); continue; }
    if (a !== b) versionDelta.push({ service, from: a, to: b, kind: bumpKind(a, b) });
  }

  const configDelta = diffConfig(from, to);
  const report = { from, to, versionDelta, configDelta };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`# Promotion ${from} → ${to}\n`);

    console.log('## Versions\n');
    if (versionDelta.length === 0) {
      console.log(`  ${to} already matches ${from}. Nothing to promote.\n`);
    } else {
      const w = Math.max(...versionDelta.map((d) => d.service.length));
      for (const d of versionDelta) {
        const arrow = `${d.from ?? '—'} → ${d.to ?? '—'}`;
        const flag = d.kind === 'MAJOR' || d.kind === 'rollback' || d.kind === 'new-service' ? `  ⚠ ${d.kind}` : `  (${d.kind})`;
        console.log(`  ${d.service.padEnd(w)}  ${arrow.padEnd(22)}${flag}`);
      }
      console.log(`\n  ${versionDelta.length} service(s) would move.\n`);
    }

    console.log('## Configuration\n');
    const structural = configDelta.filter((c) => c.missingIn || c.added?.length || c.removed?.length || c.changed?.length);
    if (structural.length === 0) {
      console.log(`  No configuration differences beyond the expected per-environment keys.\n`);
    } else {
      for (const c of structural) {
        console.log(`  ${c.service}`);
        if (c.missingIn) { console.log(`    ⚠ no config file in ${c.missingIn}`); continue; }
        for (const a of c.added) console.log(`    + ${a.key}=${a.value}    (in ${from}, absent in ${to})`);
        for (const r of c.removed) console.log(`    - ${r.key}=${r.value}    (in ${to}, absent in ${from})`);
        for (const ch of c.changed) console.log(`    ~ ${ch.key}: ${ch.target} → ${ch.source}`);
      }
      console.log('');
      console.log('  Each of these is a decision, not an automatic copy. A key added in the source');
      console.log('  usually belongs in the target too — but the VALUE frequently does not.\n');
    }

    const noise = configDelta.flatMap((c) => c.envSpecific ?? []);
    if (noise.length) {
      const keys = [...new Set(noise.map((n) => n.key))].sort();
      console.log(`  Ignored as environment-specific: ${keys.join(', ')}`);
      console.log(`  (edit ENV_SPECIFIC_KEYS in scripts/lib/overlays.mjs to change this set)\n`);
    }
  }

  if (args.out) {
    mkdirSync(join(args.out, '..'), { recursive: true });
    writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.error(`Report written to ${args.out}`);
  }

  // Exit 3 = "nothing to do", distinguishable from a real failure by a caller.
  if (versionDelta.length === 0 && configDelta.length === 0) process.exit(3);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
