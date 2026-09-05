/**
 * Runs the docs index rebuild on behalf of the workspace setup flow.
 *
 * Distinct from the git-hook path (.githooks/post-update.mjs), which detaches
 * so it can outlive a `git pull`. Here the ingest is a FOREGROUND child of an
 * interactive CLI, so:
 *   - stdio is inherited, and progress streams live instead of buffering into
 *     a log nobody is watching;
 *   - it is bounded by a timeout, because a setup that hangs forever is worse
 *     than one that gives up and tells you the manual command;
 *   - failure is non-blocking. The rest of setup succeeded; the index being a
 *     day stale is an inconvenience, not a reason to fail the developer's
 *     first action of the day.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MCP_ROOT = join(ROOT, 'mcp');
const INGEST_SCRIPT = join(MCP_ROOT, 'scripts', 'ingest-docs.mjs');

const DEFAULT_TIMEOUT_MS = Number(process.env.DOCS_INGEST_TIMEOUT_MS || 20 * 60 * 1000);

const log = (msg) => process.stdout.write(msg + '\n');

/**
 * Decide whether to rebuild, without paying for it.
 *
 * Exposed separately so `--docs-dry-run` can print the decision: a
 * change-detection heuristic you cannot inspect without waiting 20 minutes is
 * a heuristic nobody ever debugs.
 *
 * @returns {{rebuild:boolean, reason:string}}
 */
export function decideIngest({ skipDocs, ifChanged, docsChanged }) {
  if (skipDocs) return { rebuild: false, reason: '--skip-docs was passed' };
  if (!ifChanged) return { rebuild: true, reason: 'no --docs-if-changed flag: always rebuild' };
  if (docsChanged) return { rebuild: true, reason: '--docs-if-changed and docs markdown moved in at least one repo' };
  return { rebuild: false, reason: '--docs-if-changed and no repo moved docs markdown' };
}

/** True when the ingest can actually run here; otherwise a reason to print. */
export function ingestBlockedReason() {
  if (!existsSync(INGEST_SCRIPT)) return `ingest script not found at ${INGEST_SCRIPT}`;
  if (!existsSync(join(MCP_ROOT, 'node_modules'))) return 'mcp/node_modules is missing — run `cd mcp && yarn install`';
  return null;
}

/**
 * Run the ingest in the foreground. Never throws: returns success as a value so
 * the caller decides whether it matters.
 *
 * @returns {{ok:boolean, message:string}}
 */
export function runIngest({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const blocked = ingestBlockedReason();
  if (blocked) return { ok: false, message: `Skipped docs rebuild: ${blocked}` };

  log(`\nRebuilding the docs index (timeout ${Math.round(timeoutMs / 60000)}m)...`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [INGEST_SCRIPT], {
    cwd: MCP_ROOT,
    stdio: 'inherit',
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
    windowsHide: true,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  if (res.signal === 'SIGTERM') {
    return { ok: false, message: `Docs rebuild timed out after ${secs}s. Retry manually: cd mcp && yarn docs:ingest` };
  }
  if (res.status !== 0) {
    return { ok: false, message: `Docs rebuild failed after ${secs}s (exit ${res.status}). Retry manually: cd mcp && yarn docs:ingest` };
  }
  return { ok: true, message: `Docs index rebuilt in ${secs}s.` };
}
