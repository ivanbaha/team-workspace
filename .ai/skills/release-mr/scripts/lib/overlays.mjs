/**
 * Reading and writing the git-ops overlays.
 *
 * Two things define an environment, and this module is the only place that knows
 * how to find either of them:
 *
 *   1. Pinned versions — the `images:` block in overlays/<env>/kustomization.yaml.
 *   2. Configuration   — overlays/<env>/config/<service>.env, one KEY=value per line.
 *
 * Everything is line-based rather than parsed-and-reserialised through a YAML
 * library. That is deliberate: a round-trip through a YAML parser drops comments,
 * reorders keys and renormalises quoting, so a one-version promotion would produce
 * a diff touching the whole file. A release MR that a human cannot read at a glance
 * is a release MR nobody actually reviews.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '..');
export const GITOPS = join(ROOT, 'infra', 'git-ops');
export const OVERLAYS = join(GITOPS, 'overlays');

/** Promotion is one-directional. This map is what makes that a fact, not a habit. */
export const PROMOTION = { test: 'dev', prod: 'test' };
export const ENVS = ['dev', 'test', 'prod'];

export function overlayDir(env) {
  const dir = join(OVERLAYS, env);
  if (!existsSync(dir)) {
    throw new Error(`No overlay for "${env}". Expected ${dir}. Known: ${ENVS.join(', ')}`);
  }
  return dir;
}

const kustomizationPath = (env) => join(overlayDir(env), 'kustomization.yaml');

/**
 * The `images:` block, as an ordered list of { image, service, tag, tagLine }.
 *
 * `tagLine` is the 0-based line index of the `newTag:` line, which is what lets
 * writeVersions edit exactly one line per changed service.
 */
export function readVersions(env) {
  const lines = readFileSync(kustomizationPath(env), 'utf8').split('\n');
  const out = [];

  let inBlock = false;
  let pending = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^images:\s*$/.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;

    // The block ends at the first line that starts a new top-level key. Blank
    // lines and comments inside it are normal and must not end it.
    if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('#')) break;

    const nameMatch = line.match(/^\s*-\s*name:\s*(\S+)\s*$/);
    if (nameMatch) {
      pending = { image: nameMatch[1], service: nameMatch[1].split('/').pop() };
      continue;
    }

    const tagMatch = line.match(/^\s*newTag:\s*["']?([^"'\s#]+)["']?\s*$/);
    if (tagMatch && pending) {
      out.push({ ...pending, tag: tagMatch[1], tagLine: i });
      pending = null;
    }
  }

  if (out.length === 0) {
    throw new Error(`No pinned images found in ${kustomizationPath(env)}. Is the images: block intact?`);
  }
  return out;
}

/** Same data as a plain { service: tag } map, for comparisons. */
export const versionMap = (env) =>
  Object.fromEntries(readVersions(env).map((v) => [v.service, v.tag]));

/**
 * Rewrite tags in an overlay, one line at a time.
 *
 * @param {string} env
 * @param {Record<string,string>} tags  service -> new tag
 * @param {{dryRun?: boolean}} [opts]
 * @returns {{service:string, from:string, to:string}[]} what changed (or would)
 */
export function writeVersions(env, tags, opts = {}) {
  const path = kustomizationPath(env);
  const lines = readFileSync(path, 'utf8').split('\n');
  const current = readVersions(env);
  const changed = [];

  for (const entry of current) {
    const next = tags[entry.service];
    if (next === undefined || next === entry.tag) continue;

    // Replace the value only — indentation, quoting and any trailing comment on
    // that line survive untouched.
    lines[entry.tagLine] = lines[entry.tagLine].replace(
      /(^\s*newTag:\s*)(["']?)([^"'\s#]+)(["']?)/,
      `$1$2${next}$4`,
    );
    changed.push({ service: entry.service, from: entry.tag, to: next });
  }

  const unknown = Object.keys(tags).filter((s) => !current.some((c) => c.service === s));
  if (!opts.dryRun && changed.length > 0) writeFileSync(path, lines.join('\n'));
  return { changed, unknown };
}

// ── Configuration ──────────────────────────────────────────────────────────

const configDir = (env) => join(overlayDir(env), 'config');

export function listConfiguredServices(env) {
  const dir = configDir(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.env')).map((f) => f.replace(/\.env$/, '')).sort();
}

/** One service's config as { KEY: value }. Comments and blanks dropped. */
export function readConfig(env, service) {
  const file = join(configDir(env), `${service}.env`);
  if (!existsSync(file)) return null;

  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Keys whose value legitimately differs per environment, so a difference is
 * never a promotion candidate. Reporting these every release trains the reviewer
 * to skim the table, which is exactly how a real change gets waved through.
 */
export const ENV_SPECIFIC_KEYS = new Set([
  'NODE_ENV',
  'LOGGER_LEVEL',
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
]);

/**
 * Config delta between two environments, per service.
 *
 * `added`/`removed` are structural — a key that exists on one side only, which is
 * what a promotion has to decide about. `changed` is a value difference on a key
 * both sides have, reported as { source, target } rather than { from, to } so it
 * is never ambiguous which side is which. `envSpecific` is split out rather than
 * dropped, so the reviewer can see it was considered.
 */
export function diffConfig(fromEnv, toEnv) {
  const services = [...new Set([...listConfiguredServices(fromEnv), ...listConfiguredServices(toEnv)])];
  const result = [];

  for (const service of services) {
    const from = readConfig(fromEnv, service);
    const to = readConfig(toEnv, service);

    if (from === null) { result.push({ service, missingIn: fromEnv }); continue; }
    if (to === null) { result.push({ service, missingIn: toEnv }); continue; }

    const added = [], removed = [], changed = [], envSpecific = [];

    for (const [key, value] of Object.entries(from)) {
      if (!(key in to)) { added.push({ key, value }); continue; }
      if (to[key] === value) continue;
      (ENV_SPECIFIC_KEYS.has(key) ? envSpecific : changed).push({ key, source: value, target: to[key] });
    }
    for (const key of Object.keys(to)) {
      if (!(key in from)) removed.push({ key, value: to[key] });
    }

    if (added.length || removed.length || changed.length || envSpecific.length) {
      result.push({ service, added, removed, changed, envSpecific });
    }
  }
  return result;
}

/** `--flag=value` / `--flag` off argv. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

export function resolveEnvs(args) {
  const to = args.to;
  if (!to) throw new Error('Missing --to=<test|prod>');
  if (!ENVS.includes(to)) throw new Error(`Unknown target "${to}". Known: ${ENVS.join(', ')}`);

  const from = args.from ?? PROMOTION[to];
  if (!from) {
    throw new Error(`No default source for "${to}". Promotion is dev -> test -> prod; pass --from explicitly.`);
  }
  if (!ENVS.includes(from)) throw new Error(`Unknown source "${from}". Known: ${ENVS.join(', ')}`);

  // The rule this enforces is in .ai/rules/environments-and-ownership.md: a version
  // reaches prod by having been in test. Skipping is not a shortcut, it is an
  // untested composition, so it takes a deliberate override rather than a typo.
  if (PROMOTION[to] !== from && !args.force) {
    throw new Error(
      `Refusing to promote ${from} -> ${to}: the only promotions are dev -> test and test -> prod.\n` +
      `If this is genuinely intended, re-run with --force and say why in the MR description.`,
    );
  }
  return { from, to };
}
