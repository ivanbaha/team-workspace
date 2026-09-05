/**
 * Auto-start the local Qdrant container for the opt-in hybrid docs search.
 *
 * Deliberately engine-agnostic. Which container runtime a developer can use is
 * decided by their OS, their employer's licensing position on Docker Desktop,
 * and personal preference — none of which this feature should have an opinion
 * about. The CLIs differ only in name and a couple of subcommand spellings, so
 * they are expressed as a table rather than as branches.
 *
 * Select with QDRANT_ENGINE. See docs/guides/qdrant-runtimes.md for how to pick.
 */

import { spawn } from 'child_process';
import { dirname, join, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/src/docs -> mcp
const MCP_ROOT = join(__dirname, '..', '..');

const CONTAINER_NAME = 'workspace-docs-qdrant';
const IMAGE = 'qdrant/qdrant:v1.12.4';
const STORAGE = './.qdrant-storage'; // git-ignored, bind-mounted into the container

/**
 * Supported runtimes.
 *
 * `absoluteMount` — most CLIs reject a relative bind-mount source; `wslc`
 *   accepts (and prefers) one, because the path is resolved inside WSL.
 * `external` — nothing to start: the instance is already running, or it is a
 *   shared/remote deployment this machine must not try to manage.
 */
const ENGINES = {
  docker: { bin: 'docker', start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], absoluteMount: true },
  // Daemonless and rootless; the usual answer when Docker Desktop is not licensed.
  podman: { bin: 'podman', start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], absoluteMount: true },
  // containerd's CLI — Rancher Desktop, Lima, k3s environments.
  nerdctl: { bin: 'nerdctl', start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], absoluteMount: true },
  // Windows: WSL's built-in container engine (WSL >= 2.9.3). No Docker Desktop.
  wslc: { bin: 'wslc', start: ['container', 'start'], run: ['run'], stop: ['container', 'stop'], rm: ['container', 'rm', '-f'], logs: ['container', 'logs'], absoluteMount: false },
  // macOS 26+: Apple's native `container` tool, backed by a per-container VM.
  container: { bin: 'container', start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], absoluteMount: true },
  // Managed elsewhere: a manually started instance, a remote/shared deployment,
  // or Qdrant running as a bare binary.
  external: { external: true },
};

export const SUPPORTED_ENGINES = Object.keys(ENGINES);

/** True if Qdrant answers its health endpoint within the timeout. */
async function isHealthy(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/healthz`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Run a command, resolving with its exit code and captured stderr. Never throws. */
function run(bin, args) {
  return new Promise((done) => {
    const child = spawn(bin, args, { cwd: MCP_ROOT });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => done({ code: -1, stderr: err.message }));
    child.on('close', (code) => done({ code: code ?? -1, stderr: stderr.trim() }));
  });
}

/**
 * Start an existing (stopped) container, or create one if none exists.
 *
 * `start` is attempted first and its failure is not an error: that makes this
 * correct in all three states (running / stopped / never created) without
 * inspecting anything, which is one fewer CLI output format to parse per engine.
 */
async function startContainer(engineName) {
  const e = ENGINES[engineName];

  const started = await run(e.bin, [...e.start, CONTAINER_NAME]);
  if (started.code === 0) {
    logger.info(`[docs-rag] Started existing Qdrant container "${CONTAINER_NAME}" via ${e.bin}`);
    return;
  }

  if (started.code === -1 && /ENOENT|not found/i.test(started.stderr)) {
    throw new Error(
      `"${e.bin}" is not installed or not on PATH (QDRANT_ENGINE=${engineName}). ` +
      `Install it, pick another engine (${SUPPORTED_ENGINES.join(', ')}), or set ` +
      `QDRANT_ENGINE=external and start Qdrant yourself.`
    );
  }

  const mount = e.absoluteMount ? resolvePath(MCP_ROOT, STORAGE) : STORAGE;
  const created = await run(e.bin, [
    ...e.run, '-d',
    '-p', '6333:6333',
    '-p', '6334:6334',
    '-v', `${mount}:/qdrant/storage`,
    '--name', CONTAINER_NAME,
    IMAGE,
  ]);
  if (created.code !== 0) {
    throw new Error(created.stderr || `${e.bin} run exited with code ${created.code}`);
  }
  logger.info(`[docs-rag] Created and started Qdrant container "${CONTAINER_NAME}" via ${e.bin}`);
}

/**
 * Ensure Qdrant is reachable at `url`. No-op if already running; otherwise
 * starts the container and polls until healthy (or times out).
 */
export async function ensureQdrantRunning(url, { timeoutMs = 30000 } = {}) {
  if (await isHealthy(url)) {
    logger.info(`[docs-rag] Qdrant already running at ${url}`);
    return;
  }

  const engineName = (process.env.QDRANT_ENGINE || 'docker').toLowerCase();
  const engine = ENGINES[engineName];
  if (!engine) {
    throw new Error(`Invalid QDRANT_ENGINE "${engineName}". Supported: ${SUPPORTED_ENGINES.join(', ')}`);
  }

  // In external mode an unreachable Qdrant is someone else's problem to fix —
  // a laptop must not try to repair a shared or manually managed instance.
  if (engine.external) {
    throw new Error(
      `Qdrant is not reachable at ${url} and QDRANT_ENGINE=external, so nothing was started. ` +
      `Start it yourself, or set QDRANT_ENGINE to one of: ${SUPPORTED_ENGINES.filter((n) => n !== 'external').join(', ')}`
    );
  }

  logger.info(`[docs-rag] Qdrant not reachable at ${url}; starting via ${engineName}...`);
  await startContainer(engineName);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isHealthy(url)) {
      logger.info(`[docs-rag] Qdrant is up at ${url}`);
      return;
    }
  }
  throw new Error(`Qdrant did not become healthy at ${url} within ${timeoutMs}ms`);
}
