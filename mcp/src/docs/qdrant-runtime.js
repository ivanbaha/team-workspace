/**
 * Auto-start the local Qdrant container for the opt-in hybrid docs search.
 *
 * Supports both Docker and WSL container engine (`wslc`) based on the QDRANT_ENGINE
 * environment variable.
 */

import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/src/docs -> mcp
const MCP_ROOT = join(__dirname, '..', '..');

const CONTAINER_NAME = 'workspace-docs-qdrant';
const IMAGE = 'qdrant/qdrant:v1.12.4';
const STORAGE = './.qdrant-storage'; // git-ignored, bind-mounted into the container

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

/** Run a shell command, resolving with its exit code and captured stderr. */
function run(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: MCP_ROOT, shell: true });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ code: -1, stderr: err.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, stderr: stderr.trim() }));
  });
}

/** Start an existing (stopped) container, or create a new one if none exists. */
async function startContainer(engine) {
  const isWslc = engine === 'wslc';
  
  // Command patterns for wslc and docker
  const startCmd = isWslc
    ? `wslc container start ${CONTAINER_NAME}`
    : `docker start ${CONTAINER_NAME}`;
    
  logger.info(`[docs-rag] Attempting to start existing container with command: "${startCmd}"`);
  const started = await run(startCmd);
  if (started.code === 0) {
    logger.info(`[docs-rag] Started existing Qdrant container "${CONTAINER_NAME}" using ${engine}`);
    return;
  }

  // Create new container command
  // WSL bind mounts can use relative paths like ./.qdrant-storage
  // Docker bind mounts should use resolved absolute paths
  const storagePath = isWslc ? STORAGE : resolve(MCP_ROOT, STORAGE);
  const runCmd = isWslc
    ? `wslc run -d -p 6333:6333 -p 6334:6334 -v ${storagePath}:/qdrant/storage --name ${CONTAINER_NAME} ${IMAGE}`
    : `docker run -d -p 6333:6333 -p 6334:6334 -v "${storagePath}:/qdrant/storage" --name ${CONTAINER_NAME} ${IMAGE}`;

  logger.info(`[docs-rag] Container not found or failed to start. Creating new with command: "${runCmd}"`);
  const created = await run(runCmd);
  if (created.code !== 0) {
    throw new Error(created.stderr || `${engine} run exited with code ${created.code}`);
  }
  logger.info(`[docs-rag] Created and started Qdrant container "${CONTAINER_NAME}" using ${engine}`);
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

  // Get the configured container engine (default: docker)
  const engine = (process.env.QDRANT_ENGINE || 'docker').toLowerCase();
  if (engine !== 'docker' && engine !== 'wslc') {
    throw new Error(`Invalid QDRANT_ENGINE "${engine}". Allowed values: docker, wslc`);
  }

  logger.info(`[docs-rag] Qdrant not reachable at ${url}; starting via ${engine}...`);
  await startContainer(engine);

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
