#!/usr/bin/env node
/**
 * parse-scan-log.mjs — turn a container-scan job log into structured findings.
 *
 *   node .ai/skills/fix-security-vulnerabilities/scripts/parse-scan-log.mjs \
 *     --input=.ai/skills/fix-security-vulnerabilities/output/scan-raw.log \
 *     --out=.ai/skills/fix-security-vulnerabilities/output/scan.json
 *
 * Reads the box-drawing table a container scanner (Trivy and compatible) prints,
 * and splits the findings by ecosystem, because the two halves are fixed in
 * completely different places:
 *
 *   OS  (alpine/debian/ubuntu packages)  -> bump the Docker base image
 *   npm (node-pkg / yarn / npm targets)  -> resolutions and dependency bumps
 *
 * The container scan is the ONLY source for the OS half, and it is what the
 * pipeline gate actually saw. For the npm half prefer `scan-dependencies.mjs`:
 * a log table can lose rows when it is truncated, and an audit cannot.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dedupe, normaliseSeverity, parseArgs } from './lib/vulns.mjs';

const args = parseArgs();

const OS_TARGET = /\((alpine|debian|ubuntu|amazon|centos|redhat|rocky|photon|suse|oracle)\b/i;
const NPM_TARGET = /\((node-pkg|yarn|npm|pnpm)\)/i;
const VULN_ID = /^(CVE-\d{4}-\d+|GHSA-[a-z0-9-]+|[A-Z]+-\d{4}-\d+)$/i;

/** Cells of a box-drawing table row, or null if the line is not one. */
function cells(line) {
  if (!line.includes('│') && !line.includes('|')) return null;
  const sep = line.includes('│') ? '│' : '|';
  const parts = line.split(sep);
  if (parts.length < 3) return null;
  return parts.slice(1, -1).map((c) => c.trim());
}

function parse(text) {
  const lines = text.split('\n');
  const findings = [];
  const reportedTotals = [];

  let ecosystem = null;
  let target = null;
  // A wrapped row repeats nothing: its library and vulnerability cells are blank
  // and only the title continues. Carrying the last real values forward is what
  // stops a long CVE title from being read as a second, nameless finding.
  let lastPackage = null;

  for (const line of lines) {
    // Target header, e.g. "myimage:1.2.3 (alpine 3.19.1)" or "Node.js (node-pkg)"
    if (OS_TARGET.test(line) && !line.includes('│')) {
      ecosystem = 'os'; target = line.trim(); lastPackage = null; continue;
    }
    if (NPM_TARGET.test(line) && !line.includes('│')) {
      ecosystem = 'npm'; target = line.trim(); lastPackage = null; continue;
    }

    const totals = line.match(/^Total:\s*(\d+)\s*\(([^)]*)\)/);
    if (totals) {
      reportedTotals.push({ target, ecosystem, total: Number(totals[1]), breakdown: totals[2] });
      continue;
    }

    const c = cells(line);
    if (!c || c.length < 5) continue;

    // Header and separator rows.
    if (/^library$/i.test(c[0]) || c.every((x) => /^[-─┼┬┴─\s]*$/.test(x))) continue;

    const [pkg, id, severity, status, installed, fixed] = c;
    if (!VULN_ID.test(id ?? '')) continue;

    const packageName = pkg || lastPackage;
    if (!packageName) continue;
    lastPackage = packageName;

    findings.push({
      source: 'container-scan',
      ecosystem: ecosystem ?? 'unknown',
      target,
      package: packageName,
      id: id.toUpperCase(),
      aliases: [id.toUpperCase()],
      title: c[6] ?? c[c.length - 1] ?? null,
      severity: normaliseSeverity(severity),
      status: status || null,
      installed: installed || null,
      // "will_not_fix" / "affected" mean no fixed version exists; an empty cell
      // means the same thing. Both must survive into the plan as "no fix", not be
      // silently dropped — an unfixable finding is a decision for a human.
      fixedIn: fixed && fixed !== '-' ? fixed : null,
      paths: [],
    });
  }

  return { findings, reportedTotals };
}

try {
  if (!args.input) throw new Error('Missing --input=<path to the scan job log>');

  const { findings, reportedTotals } = parse(readFileSync(args.input, 'utf8'));
  const os = dedupe(findings.filter((f) => f.ecosystem === 'os'));
  const npm = dedupe(findings.filter((f) => f.ecosystem === 'npm'));
  const other = dedupe(findings.filter((f) => !['os', 'npm'].includes(f.ecosystem)));

  const count = (list) => list.reduce((a, v) => ({ ...a, [v.severity]: (a[v.severity] ?? 0) + 1 }), {});
  const report = {
    input: args.input,
    parsedAt: new Date().toISOString(),
    rawRows: findings.length,
    reportedTotals,
    os: { totals: count(os), vulnerabilities: os },
    npm: { totals: count(npm), vulnerabilities: npm },
    other: { totals: count(other), vulnerabilities: other },
  };

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(report, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`# Container scan — ${args.input}\n`);
    for (const [label, group] of [['OS', os], ['npm', npm], ['other', other]]) {
      if (group.length === 0) continue;
      console.log(`## ${label} (${group.length} unique)\n`);
      const w = Math.max(...group.map((v) => v.package.length));
      for (const v of group) {
        console.log(`  ${v.severity.padEnd(8)} ${v.package.padEnd(w)}  ${v.installed ?? '?'} → ${v.fixedIn ?? 'NO FIX'}   ${v.id}`);
      }
      console.log('');
    }

    // The scanner's own Total: line counts one row per dependency path. Printing
    // both numbers side by side is the cheapest way to stop someone reporting
    // "we had 40 vulnerabilities" when there were nine.
    const claimed = reportedTotals.reduce((a, t) => a + t.total, 0);
    const unique = os.length + npm.length + other.length;
    if (claimed && claimed !== unique) {
      console.log(`  Scanner reported ${claimed} findings; ${unique} are unique (package + advisory).`);
    }
    if (findings.length === 0) {
      console.log('  No findings parsed. If the job log clearly HAS a table, the format may have');
      console.log('  changed — check the raw log rather than reporting the service as clean.');
    }
    if (args.out) console.log(`\n  Written to ${args.out}`);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
