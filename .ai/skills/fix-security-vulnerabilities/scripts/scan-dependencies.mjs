#!/usr/bin/env node
/**
 * scan-dependencies.mjs — run the package auditor in a service and normalise it.
 *
 *   node .ai/skills/fix-security-vulnerabilities/scripts/scan-dependencies.mjs \
 *     --service=backend/products-service \
 *     --out=.ai/skills/fix-security-vulnerabilities/output/audit.json
 *
 * Supports `yarn audit` (v1 NDJSON) and `npm audit --json`, picked from the
 * lockfile present. Both exit non-zero when advisories exist — that is a result,
 * not a failure, so the exit code is ignored and the output is always parsed.
 *
 * WHY THIS IS THE PRIMARY SOURCE for language-level findings: for npm packages an
 * audit reports the same unique advisories a container scanner does, but it needs
 * no image, no registry auth and no log scraping, and it is the tool that verifies
 * the fix afterwards. The container scan still matters — it is the only source for
 * OS-level findings and it is what the pipeline gate actually saw.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dedupe, normaliseSeverity, parseArgs, resolveService } from './lib/vulns.mjs';

const args = parseArgs();

function detectTool(dir) {
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return existsSync(join(dir, 'node_modules')) ? 'npm' : null;
}

/** yarn v1 emits one JSON object per line; only auditAdvisory rows matter. */
function parseYarn(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type !== 'auditAdvisory') continue;

    const a = row.data?.advisory ?? {};
    findings.push({
      source: 'audit',
      ecosystem: 'npm',
      package: a.module_name,
      id: a.cves?.[0] || a.github_advisory_id || `ADVISORY-${a.id}`,
      aliases: [...(a.cves ?? []), a.github_advisory_id].filter(Boolean),
      title: a.title,
      severity: normaliseSeverity(a.severity),
      installed: a.findings?.[0]?.version ?? null,
      vulnerable: a.vulnerable_versions,
      fixedIn: firstVersionOf(a.patched_versions),
      paths: (a.findings?.[0]?.paths ?? []).slice(0, 3),
      url: a.url,
    });
  }
  return findings;
}

/** npm v7+ groups by package, with `via` holding either advisories or names. */
function parseNpm(stdout) {
  let doc;
  try { doc = JSON.parse(stdout); } catch { return []; }
  const findings = [];

  for (const [name, node] of Object.entries(doc.vulnerabilities ?? {})) {
    const advisories = (node.via ?? []).filter((v) => typeof v === 'object');
    if (advisories.length === 0) {
      // Vulnerable only through a dependency — the fix lands on that dependency,
      // so recording it here would double-count the same advisory.
      continue;
    }
    for (const a of advisories) {
      findings.push({
        source: 'audit',
        ecosystem: 'npm',
        package: name,
        id: a.cve || a.source ? String(a.cve || `GHSA-${a.source}`) : a.title,
        aliases: [a.cve, a.url].filter(Boolean),
        title: a.title,
        severity: normaliseSeverity(a.severity ?? node.severity),
        installed: null,
        vulnerable: a.range ?? node.range,
        fixedIn: typeof node.fixAvailable === 'object' ? node.fixAvailable.version : null,
        paths: (node.nodes ?? []).slice(0, 3),
        url: a.url,
      });
    }
  }
  return findings;
}

/** "">=4.7.9"" / "">=4.7.9 <5.0.0"" -> "4.7.9" */
const firstVersionOf = (range) => String(range ?? '').match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;

try {
  const serviceArg = args.service;
  if (!serviceArg) throw new Error('Missing --service=<name or workspace-relative path>');

  const dir = resolveService(serviceArg);
  const tool = args.tool ?? detectTool(dir);
  if (!tool) throw new Error(`No lockfile in ${dir} — cannot tell whether to run yarn or npm.`);

  const cmd = tool === 'yarn' ? ['yarn', ['audit', '--json']] : ['npm', ['audit', '--json']];
  const res = spawnSync(cmd[0], cmd[1], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (res.error) throw new Error(`Could not run \`${tool} audit\` in ${dir}: ${res.error.message}`);
  // A non-zero status is the normal outcome when advisories exist; only an empty
  // stdout means the command genuinely failed to produce a report.
  if (!res.stdout?.trim()) {
    throw new Error(`\`${tool} audit\` produced no output.\n${(res.stderr ?? '').trim()}`);
  }

  const raw = tool === 'yarn' ? parseYarn(res.stdout) : parseNpm(res.stdout);
  const vulnerabilities = dedupe(raw);

  const totals = vulnerabilities.reduce((acc, v) => ({ ...acc, [v.severity]: (acc[v.severity] ?? 0) + 1 }), {});
  const report = {
    service: serviceArg,
    serviceDir: dir,
    tool,
    scannedAt: new Date().toISOString(),
    rawFindings: raw.length,
    uniqueFindings: vulnerabilities.length,
    totals,
    vulnerabilities,
  };

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(report, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`# ${tool} audit — ${serviceArg}\n`);
    if (vulnerabilities.length === 0) {
      console.log('  0 vulnerabilities.\n');
    } else {
      const w = Math.max(...vulnerabilities.map((v) => v.package.length));
      for (const v of vulnerabilities) {
        const fix = v.fixedIn ? `fixed in ${v.fixedIn}` : 'NO FIX AVAILABLE';
        console.log(`  ${v.severity.padEnd(8)} ${v.package.padEnd(w)}  ${fix}   ${v.id}`);
      }
      console.log(
        `\n  ${vulnerabilities.length} unique advisories (${raw.length} raw rows — ` +
        `the tool counts one per dependency path).`,
      );
    }
    if (args.out) console.log(`\n  Written to ${args.out}`);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
