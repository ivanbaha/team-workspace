#!/usr/bin/env node
/**
 * validate-overlays.mjs — does every overlay still build?
 *
 *   node .ai/skills/release-mr/scripts/validate-overlays.mjs            # all three
 *   node .ai/skills/release-mr/scripts/validate-overlays.mjs --env=prod
 *
 * Catches what hand-editing YAML breaks: bad indentation, a config file removed
 * but still referenced by the generator, a patch naming a resource that no longer
 * exists. All of these produce a perfectly valid-looking diff and a deployment
 * that fails to sync — so the build runs before the commit, not after the merge.
 *
 * Uses `kustomize` when installed and falls back to `kubectl kustomize`, which is
 * the same builder and is present wherever kubectl is.
 */

import { spawnSync } from 'node:child_process';
import { ENVS, GITOPS, overlayDir, parseArgs, readVersions } from './lib/overlays.mjs';
import { relative } from 'node:path';

const args = parseArgs();

function builder() {
  if (spawnSync('kustomize', ['version'], { stdio: 'ignore' }).status === 0) {
    return { cmd: 'kustomize', pre: ['build'] };
  }
  if (spawnSync('kubectl', ['version', '--client'], { stdio: 'ignore' }).status === 0) {
    return { cmd: 'kubectl', pre: ['kustomize'] };
  }
  return null;
}

const tool = builder();
if (!tool) {
  console.error('ERROR: neither `kustomize` nor `kubectl` is on PATH — cannot validate.');
  console.error('       Install one, or ask the operator to run the build. Do NOT commit an');
  console.error('       overlay change you have not built.');
  process.exit(1);
}

const targets = args.env ? [args.env] : ENVS;
let failed = 0;

for (const env of targets) {
  let dir;
  try {
    dir = overlayDir(env);
  } catch (err) {
    console.error(`  FAIL   ${env}  ${err.message}`);
    failed++;
    continue;
  }

  const res = spawnSync(tool.cmd, [...tool.pre, dir], { encoding: 'utf8' });

  if (res.status !== 0) {
    failed++;
    console.error(`  FAIL   ${env}  (${tool.cmd} ${tool.pre.join(' ')} ${relative(GITOPS, dir)})`);
    console.error((res.stderr || res.stdout || '').trim().split('\n').map((l) => `         ${l}`).join('\n'));
    continue;
  }

  const objects = (res.stdout.match(/^kind:/gm) ?? []).length;
  const pinned = readVersions(env).length;

  // A build that succeeds while silently producing nothing is the failure mode a
  // plain exit-code check misses — an overlay whose resources list got emptied
  // builds fine and deploys nothing.
  if (objects === 0) {
    failed++;
    console.error(`  FAIL   ${env}  built successfully but produced 0 objects`);
    continue;
  }

  const stale = res.stdout.includes(':0.0.0-base');
  console.log(`  ok     ${env}  ${objects} objects, ${pinned} services pinned${stale ? '   ⚠ an image is still on the base placeholder tag' : ''}`);
  if (stale) failed++;
}

if (failed) {
  console.error(`\n${failed} overlay(s) failed. Fix before committing.`);
  process.exit(1);
}
console.log(`\nAll ${targets.length} overlay(s) build.`);
