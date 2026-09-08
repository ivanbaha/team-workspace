#!/usr/bin/env node
/**
 * build-fix-plan.mjs — turn findings into a plan a machine can apply.
 *
 *   node .ai/skills/fix-security-vulnerabilities/scripts/build-fix-plan.mjs \
 *     --service=backend/products-service \
 *     --audit=.ai/skills/fix-security-vulnerabilities/output/audit.json \
 *     --scan=.ai/skills/fix-security-vulnerabilities/output/scan.json \
 *     --severities=CRITICAL,HIGH \
 *     --base-image=node:24.9.0-alpine3.21 \
 *     --out-dir=.ai/skills/fix-security-vulnerabilities/output
 *
 * Both inputs are optional; at least one is required. Findings are merged on
 * (package + advisory), so the two scanners' overlap collapses instead of being
 * fixed twice.
 *
 * Three decisions this makes, and the reasoning behind each:
 *
 *   - TARGET VERSION is the LOWEST published version clearing every advisory on
 *     that package, not the latest. The smallest bump that fixes the problem is
 *     the one least likely to break the build.
 *   - MAJOR BUMPS are excluded by default (--allow-major to include them) and
 *     always reported. A major jump to fix a MEDIUM advisory routinely breaks a
 *     toolchain, which turns a security fix into a week of work.
 *   - EVERY fixed package gets a `resolutions` entry, because most findings are
 *     transitive. A package that is ALSO a direct dependency gets bumped there
 *     too, so the manifest and the lockfile do not disagree.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SEVERITIES, dedupe, isMajorBump, parseArgs, pickTargetVersion,
  readPackageJson, registryVersions, resolveService, severityRank,
} from './lib/vulns.mjs';

const args = parseArgs();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

try {
  if (!args.service) throw new Error('Missing --service=<name or workspace-relative path>');
  if (!args.audit && !args.scan) throw new Error('Pass at least one of --audit=<file> / --scan=<file>');

  const serviceDir = resolveService(args.service);
  const pkgJson = readPackageJson(serviceDir);
  const outDir = args['out-dir'] ?? '.ai/skills/fix-security-vulnerabilities/output';
  const allowMajor = Boolean(args['allow-major']);

  const severities = String(args.severities ?? 'CRITICAL,HIGH')
    .split(',').map((s) => s.trim().toUpperCase()).filter((s) => SEVERITIES.includes(s));
  if (severities.length === 0) throw new Error(`--severities must name some of: ${SEVERITIES.join(', ')}`);

  // ── Collect ──────────────────────────────────────────────────────────────
  const audit = args.audit && existsSync(args.audit) ? readJson(args.audit) : null;
  const scan = args.scan && existsSync(args.scan) ? readJson(args.scan) : null;

  const packageFindings = dedupe([
    ...(audit?.vulnerabilities ?? []),
    ...(scan?.npm?.vulnerabilities ?? []),
  ]);
  const osFindings = scan?.os?.vulnerabilities ?? [];

  const inScope = packageFindings.filter((f) => severities.includes(f.severity));
  const skipped = packageFindings.filter((f) => !severities.includes(f.severity));

  // ── Resolve a target version per package ────────────────────────────────
  const directDeps = { ...(pkgJson.dependencies ?? {}) };
  const devDeps = { ...(pkgJson.devDependencies ?? {}) };

  const byPackage = new Map();
  for (const f of inScope) {
    if (!byPackage.has(f.package)) byPackage.set(f.package, []);
    byPackage.get(f.package).push(f);
  }

  const resolutions = {};
  const dependencyUpdates = {};
  const devDependencyUpdates = {};
  const majorBumps = [];
  const noFix = [];
  const unresolved = [];

  for (const [pkg, findings] of [...byPackage.entries()].sort()) {
    const minimums = findings.map((f) => f.fixedIn).filter(Boolean);
    if (minimums.length === 0) {
      noFix.push({ package: pkg, findings: findings.map((f) => ({ id: f.id, severity: f.severity })) });
      continue;
    }

    const installed = findings.find((f) => f.installed)?.installed ?? null;
    const available = registryVersions(pkg, serviceDir);

    if (available === null) {
      // The registry is unreachable, or this package is not on it. Falling back
      // to the advisory's own floor keeps the plan usable; flagging it means
      // nobody mistakes an unverified version for a checked one.
      const floor = minimums.sort()[minimums.length - 1];
      unresolved.push({ package: pkg, using: floor, reason: 'registry unreachable — version not verified' });
      resolutions[pkg] = floor;
      continue;
    }

    let target = pickTargetVersion(available, minimums, { stayInMajor: !allowMajor, current: installed });

    if (!target) {
      // Nothing inside the current major fixes it. That is a real decision, not
      // a dead end — report it with the version that WOULD work.
      const crossMajor = pickTargetVersion(available, minimums, { stayInMajor: false, current: installed });
      if (crossMajor) {
        majorBumps.push({
          package: pkg, from: installed, to: crossMajor, included: allowMajor,
          severities: [...new Set(findings.map((f) => f.severity))],
        });
        if (!allowMajor) continue;
        target = crossMajor;
      } else {
        noFix.push({
          package: pkg,
          findings: findings.map((f) => ({ id: f.id, severity: f.severity })),
          note: 'no published version satisfies the advisories',
        });
        continue;
      }
    }

    if (installed && isMajorBump(installed, target)) {
      majorBumps.push({
        package: pkg, from: installed, to: target, included: true,
        severities: [...new Set(findings.map((f) => f.severity))],
      });
    }

    resolutions[pkg] = target;
    if (pkg in directDeps) dependencyUpdates[pkg] = target;
    if (pkg in devDeps) devDependencyUpdates[pkg] = target;
  }

  // ── The plan ─────────────────────────────────────────────────────────────
  const plan = {
    service: args.service,
    serviceDir,
    generatedAt: new Date().toISOString(),
    severities,
    allowMajor,
    ...(args['base-image'] ? { dockerfile: { baseImage: { set: args['base-image'] } } } : {}),
    resolutions: { set: resolutions },
    dependencies: { update: dependencyUpdates },
    devDependencies: { update: devDependencyUpdates },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'fix-plan.json'), JSON.stringify(plan, null, 2));

  // ── The report ───────────────────────────────────────────────────────────
  const row = (v) => `| ${v.package} | ${v.installed ?? '?'} | ${resolutions[v.package] ?? '—'} | ${v.severity} | ${v.id} |`;
  const md = [
    `# Vulnerability fix plan — ${args.service}`,
    ``,
    `Generated ${plan.generatedAt} · severities: ${severities.join(', ')}${allowMajor ? ' · major bumps allowed' : ''}`,
    ``,
    `## Package vulnerabilities to fix (${inScope.length} advisories, ${Object.keys(resolutions).length} packages)`,
    ``,
    `| Package | Installed | → Target | Severity | Advisory |`,
    `|---|---|---|---|---|`,
    ...inScope.filter((v) => resolutions[v.package]).sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).map(row),
    ``,
    ...(majorBumps.length ? [
      `## Major version bumps — verify compatibility`, ``,
      ...majorBumps.map((m) => `- \`${m.package}\` ${m.from ?? '?'} → ${m.to} (${m.severities.join(', ')})${m.included ? '' : ' — **excluded**, re-run with `--allow-major` to include'}`),
      ``,
    ] : []),
    ...(noFix.length ? [
      `## No fix available`, ``,
      ...noFix.map((n) => `- \`${n.package}\` — ${n.findings.map((f) => `${f.id} (${f.severity})`).join(', ')}${n.note ? ` — ${n.note}` : ''}`),
      ``,
    ] : []),
    ...(unresolved.length ? [
      `## Version not verified against the registry`, ``,
      ...unresolved.map((u) => `- \`${u.package}\` → ${u.using} — ${u.reason}`),
      ``,
    ] : []),
    ...(osFindings.length ? [
      `## OS-level (base image)`, ``,
      `These are not fixed by package resolutions. They need a base image bump.`, ``,
      ...osFindings.map((v) => `- \`${v.package}\` ${v.installed ?? '?'} → ${v.fixedIn ?? 'no fix'} — ${v.id} (${v.severity})`),
      ``,
      args['base-image']
        ? `Target base image: \`${args['base-image']}\``
        : `**No \`--base-image\` given** — the plan will not touch the Dockerfile. Get a target image first.`,
      ``,
    ] : []),
    ...(skipped.length ? [
      `## Skipped (outside the selected severities)`, ``,
      ...skipped.map((v) => `- \`${v.package}\` ${v.id} (${v.severity})`),
      ``,
    ] : []),
  ].join('\n');

  writeFileSync(join(outDir, 'fix-report.md'), md);

  console.log(md);
  console.log(`\n---\nPlan:   ${join(outDir, 'fix-plan.json')}`);
  console.log(`Report: ${join(outDir, 'fix-report.md')}`);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
