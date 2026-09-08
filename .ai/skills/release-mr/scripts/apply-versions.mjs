#!/usr/bin/env node
/**
 * apply-versions.mjs — write the source environment's pinned versions into the target.
 *
 *   node .ai/skills/release-mr/scripts/apply-versions.mjs --to=test --dry-run
 *   node .ai/skills/release-mr/scripts/apply-versions.mjs --to=prod
 *   node .ai/skills/release-mr/scripts/apply-versions.mjs --to=test --only=users-service,host-frontend
 *   node .ai/skills/release-mr/scripts/apply-versions.mjs --to=test --exclude=products-service
 *
 * VERSIONS ONLY. Configuration is deliberately not touched here: `diff-envs.mjs`
 * reports config deltas so a human decides each one, because the value that is
 * right in the source environment is frequently wrong in the target (a URL, a
 * feature flag, a cache TTL sized for a different load).
 *
 * Only the `newTag:` lines change, so `git diff` on the result is one line per
 * promoted service and reviewable at a glance.
 */

import { parseArgs, resolveEnvs, versionMap, writeVersions } from './lib/overlays.mjs';

const args = parseArgs();
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

try {
  const { from, to } = resolveEnvs(args);
  const dryRun = Boolean(args['dry-run'] ?? args.dryRun);

  const only = new Set(list(args.only));
  const exclude = new Set(list(args.exclude));

  let tags = versionMap(from);
  if (only.size) tags = Object.fromEntries(Object.entries(tags).filter(([s]) => only.has(s)));
  if (exclude.size) tags = Object.fromEntries(Object.entries(tags).filter(([s]) => !exclude.has(s)));

  const missing = [...only].filter((s) => !(s in versionMap(from)));
  if (missing.length) {
    throw new Error(`--only names service(s) not pinned in ${from}: ${missing.join(', ')}`);
  }

  const { changed, unknown } = writeVersions(to, tags, { dryRun });

  console.log(`# ${dryRun ? 'DRY RUN — ' : ''}${from} → ${to}\n`);

  if (changed.length === 0) {
    console.log(`  Nothing to write: ${to} already matches ${from} for the selected services.`);
  } else {
    const w = Math.max(...changed.map((c) => c.service.length));
    for (const c of changed) console.log(`  ${c.service.padEnd(w)}  ${c.from} → ${c.to}`);
    console.log(`\n  ${changed.length} version(s) ${dryRun ? 'would be' : ''} written to infra/git-ops/overlays/${to}/kustomization.yaml`);
  }

  // A service pinned in the source but absent from the target is a real event —
  // usually a new service that nobody has added to this environment yet. Silently
  // skipping it is how a service ships to test and never reaches prod.
  if (unknown.length) {
    console.log(`\n  ⚠ Pinned in ${from} but not present in ${to}: ${unknown.join(', ')}`);
    console.log(`     Add it to overlays/${to}/kustomization.yaml (and its config/<service>.env) by hand,`);
    console.log(`     or confirm it is intentionally not deployed there.`);
  }

  if (!dryRun && changed.length > 0) {
    console.log(`\n  Next: validate-overlays.mjs --env=${to}, then review \`git diff\` before committing.`);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
