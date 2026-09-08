/**
 * Shared vocabulary for the two scanners.
 *
 * A container scanner (Trivy) and a package auditor (`yarn audit` / `npm audit`)
 * describe the same npm advisory in different words, at different granularity,
 * with different severity spellings. Normalising both into one shape here is what
 * lets the fix plan treat them as one set instead of two lists that mostly overlap.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const SEVERITY_ALIASES = {
  critical: 'CRITICAL', high: 'HIGH',
  moderate: 'MEDIUM', medium: 'MEDIUM',
  low: 'LOW', info: 'LOW', informational: 'LOW',
};

export const normaliseSeverity = (s) =>
  SEVERITY_ALIASES[String(s ?? '').toLowerCase()] ?? 'UNKNOWN';

export const severityRank = (s) => {
  const i = SEVERITIES.indexOf(normaliseSeverity(s));
  return i === -1 ? SEVERITIES.length : i;
};

/**
 * Both tools report one row per dependency PATH, not per advisory, so their
 * headline totals are inflated several times over — "14 vulnerabilities" is
 * routinely four unique CVEs reached through fourteen import chains. Every count
 * this skill reports is of the deduplicated (package + advisory) set, which is
 * also the set a fix has to clear.
 */
export function dedupe(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const key = `${f.package}@@${f.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...f, occurrences: 1 });
      continue;
    }
    existing.occurrences++;
    // Keep the worst severity and the highest fix requirement seen on any path.
    if (severityRank(f.severity) < severityRank(existing.severity)) existing.severity = f.severity;
    if (f.fixedIn && !existing.fixedIn) existing.fixedIn = f.fixedIn;
    if (f.paths?.length && existing.paths.length < 3) {
      existing.paths = [...new Set([...existing.paths, ...f.paths])].slice(0, 3);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.package.localeCompare(b.package),
  );
}

// ── semver, only as much as this needs ─────────────────────────────────────

export function parseSemver(v) {
  const m = String(v ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

export function compareSemver(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

export const isMajorBump = (from, to) => {
  const a = parseSemver(from), b = parseSemver(to);
  return Boolean(a && b && b.major > a.major);
};

/**
 * Lowest published version that satisfies every advisory on a package.
 *
 * "Lowest that clears everything" rather than "latest": the smallest bump that
 * actually fixes the problem is the one least likely to break the build, and a
 * package with a HIGH fixed in 10.1.1 and a MEDIUM fixed in 10.1.2 must go to
 * 10.1.2, not to whatever `latest` happens to be that week.
 */
export function pickTargetVersion(available, minimums, { stayInMajor, current } = {}) {
  const floor = minimums.filter(Boolean).sort(compareSemver).pop();
  if (!floor) return null;

  const currentMajor = parseSemver(current)?.major;
  const candidates = available
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v)) // no prereleases
    .filter((v) => compareSemver(v, floor) >= 0)
    .filter((v) => !stayInMajor || currentMajor === undefined || parseSemver(v)?.major === currentMajor)
    .sort(compareSemver);

  return candidates[0] ?? null;
}

/** Published versions of a package, or null when the registry is unreachable. */
export function registryVersions(pkg, cwd = ROOT) {
  try {
    const out = execFileSync('npm', ['view', pkg, 'versions', '--json'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

// ── the service under repair ───────────────────────────────────────────────

export function resolveService(nameOrPath) {
  const direct = join(ROOT, nameOrPath);
  if (existsSync(join(direct, 'package.json'))) return direct;

  const registryPath = join(ROOT, 'configs', 'workspace-repos.json');
  if (existsSync(registryPath)) {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8'));
    for (const [key, entries] of Object.entries(raw)) {
      if (key.startsWith('$') || !Array.isArray(entries)) continue;
      const hit = entries.find((e) => e.name === nameOrPath);
      if (hit?.localPath && existsSync(join(ROOT, hit.localPath))) return join(ROOT, hit.localPath);
    }
  }
  throw new Error(
    `Cannot locate service "${nameOrPath}". Pass a workspace-relative path, or add it to ` +
    `configs/workspace-repos.json with a localPath.`,
  );
}

export const readPackageJson = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}
