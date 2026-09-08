#!/usr/bin/env node
/**
 * validate-overlay.mjs — PostToolUse(Edit|Write|MultiEdit)
 *
 * Builds a git-ops overlay right after it is edited, so a break surfaces at the
 * edit rather than at commit time — or, worse, at sync time.
 *
 * The failure mode is specific: hand-edited kustomize YAML produces a diff that
 * looks entirely reasonable and a build that fails. A config file removed but
 * still referenced by a generator, a patch naming a resource that no longer
 * exists, one wrong indent level. None of it is visible in review.
 *
 * Reports; never blocks. A half-finished edit is a normal state to be in.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, allow, filePathOf, notify, readEvent } from './lib/hook-io.mjs';

const event = readEvent();
const file = filePathOf(event);
if (!file) allow();

const match = file.match(/^infra\/git-ops\/(?:overlays\/([^/]+)|base)\//);
if (!match) allow();

// A change under base/ reaches all three environments, so all three are built.
const envs = match[1] ? [match[1]] : ['dev', 'test', 'prod'];

function builder() {
  if (spawnSync('kustomize', ['version'], { stdio: 'ignore' }).status === 0) return ['kustomize', 'build'];
  if (spawnSync('kubectl', ['version', '--client'], { stdio: 'ignore' }).status === 0) return ['kubectl', 'kustomize'];
  return null;
}

const tool = builder();
// Neither builder installed is the operator's environment, not a finding. Saying
// so on every single edit would be noise.
if (!tool) allow();

const failures = [];
for (const env of envs) {
  const dir = join(ROOT, 'infra', 'git-ops', 'overlays', env);
  if (!existsSync(dir)) continue;

  const res = spawnSync(tool[0], [tool[1], dir], { encoding: 'utf8' });
  if (res.status !== 0) {
    failures.push({ env, error: (res.stderr || res.stdout || '').trim().split('\n').slice(0, 6).join('\n') });
    continue;
  }
  if (!/^kind:/m.test(res.stdout ?? '')) {
    failures.push({ env, error: 'builds, but produces no objects' });
  }
}

if (failures.length === 0) allow();

notify(
  `git-ops overlay build FAILED after editing ${file}:\n\n` +
  failures.map((f) => `  [${f.env}]\n${f.error.split('\n').map((l) => `    ${l}`).join('\n')}`).join('\n\n') +
  `\n\nFix this before committing — an overlay that does not build cannot deploy, and the\n` +
  `diff will look fine in review. Re-check with:\n\n` +
  `  node .ai/skills/release-mr/scripts/validate-overlays.mjs`,
);
