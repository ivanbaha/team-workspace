#!/usr/bin/env node
/**
 * read-versions.mjs — what is pinned in one environment right now.
 *
 *   node .ai/skills/release-mr/scripts/read-versions.mjs --env=test
 *   node .ai/skills/release-mr/scripts/read-versions.mjs --env=prod --json
 *
 * With --all, prints every environment side by side, which is the fastest way to
 * see how far test has drifted from prod before starting a release.
 */

import { ENVS, parseArgs, readVersions, versionMap } from './lib/overlays.mjs';

const args = parseArgs();

try {
  if (args.all) {
    const maps = Object.fromEntries(ENVS.map((e) => [e, versionMap(e)]));
    const services = [...new Set(ENVS.flatMap((e) => Object.keys(maps[e])))].sort();

    if (args.json) {
      console.log(JSON.stringify({ environments: maps }, null, 2));
    } else {
      const w = Math.max(...services.map((s) => s.length), 7);
      console.log(`${'service'.padEnd(w)} | ${ENVS.map((e) => e.padEnd(10)).join(' | ')}`);
      console.log(`${'-'.repeat(w)}-+-${ENVS.map(() => '-'.repeat(10)).join('-+-')}-`);
      for (const s of services) {
        const cells = ENVS.map((e) => (maps[e][s] ?? '—').padEnd(10));
        // A service on the same tag everywhere is settled; the interesting rows
        // are the ones that differ, so mark them rather than making the reader
        // compare five-character strings by eye.
        const drift = new Set(ENVS.map((e) => maps[e][s])).size > 1 ? ' *' : '';
        console.log(`${s.padEnd(w)} | ${cells.join(' | ')}${drift}`);
      }
      console.log('\n* differs between environments');
    }
    process.exit(0);
  }

  const env = args.env;
  if (!env) throw new Error('Missing --env=<dev|test|prod>   (or --all)');

  const versions = readVersions(env);
  if (args.json) {
    console.log(JSON.stringify({ env, versions: versionMap(env) }, null, 2));
  } else {
    const w = Math.max(...versions.map((v) => v.service.length));
    console.log(`# ${env}\n`);
    for (const v of versions) console.log(`  ${v.service.padEnd(w)}  ${v.tag}`);
    console.log(`\n${versions.length} services pinned.`);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
