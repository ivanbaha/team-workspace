#!/usr/bin/env node
/**
 * Engine-agnostic Qdrant container control.
 *
 * One command that reads QDRANT_ENGINE, instead of a `qdrant:up:docker`,
 * `qdrant:up:podman`, `qdrant:up:wslc`, … matrix in package.json. The engine is
 * a property of the developer's machine, so it belongs in their `.env`, not in
 * the command they have to remember to type.
 *
 * Run:
 *   yarn qdrant up       create + start (pulls the image on first use)
 *   yarn qdrant start    start an existing, stopped container
 *   yarn qdrant stop     stop it, keeping the bind-mounted volume
 *   yarn qdrant rm       remove the container (the volume survives)
 *   yarn qdrant logs     the container's own logs
 *   yarn qdrant status   engine, container state, and endpoint health
 */

import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'workspace-docs-qdrant';
const IMAGE = 'qdrant/qdrant:v1.12.4';
const STORAGE = './.qdrant-storage';
const URL = (process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/$/, '');

// Mirrors ENGINES in src/docs/qdrant-runtime.js — same table, CLI side.
const ENGINES = {
  docker:    { bin: 'docker',  start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], ps: ['ps', '-a'], absoluteMount: true },
  podman:    { bin: 'podman',  start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], ps: ['ps', '-a'], absoluteMount: true },
  nerdctl:   { bin: 'nerdctl', start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], ps: ['ps', '-a'], absoluteMount: true },
  wslc:      { bin: 'wslc',    start: ['container', 'start'], run: ['run'], stop: ['container', 'stop'], rm: ['container', 'rm', '-f'], logs: ['container', 'logs'], ps: ['container', 'ls', '-a'], absoluteMount: false },
  container: { bin: 'container', start: ['start'], run: ['run'], stop: ['stop'], rm: ['rm', '-f'], logs: ['logs'], ps: ['ls', '-a'], absoluteMount: true },
  external:  { external: true },
};

const cmd = (process.argv[2] || 'status').toLowerCase();
const engineName = (process.env.QDRANT_ENGINE || 'docker').toLowerCase();
const e = ENGINES[engineName];

if (!e) {
  console.error(`Invalid QDRANT_ENGINE "${engineName}". Supported: ${Object.keys(ENGINES).join(', ')}`);
  process.exit(2);
}

if (e.external && cmd !== 'status') {
  console.error(
    `QDRANT_ENGINE=external — this workspace does not manage the Qdrant lifecycle.\n` +
    `Start/stop it wherever it actually runs, or set QDRANT_ENGINE to one of: ` +
    `${Object.keys(ENGINES).filter((n) => n !== 'external').join(', ')}`
  );
  process.exit(2);
}

const sh = (args, opts = {}) => spawnSync(e.bin, args, { stdio: 'inherit', cwd: MCP_ROOT, ...opts });

async function healthy() {
  try {
    const res = await fetch(`${URL}/healthz`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

switch (cmd) {
  case 'up': {
    // Try start first: correct whether the container is stopped or absent,
    // without parsing any engine's `ps` output format.
    if (sh([...e.start, NAME], { stdio: 'ignore' }).status === 0) {
      console.log(`Started existing container "${NAME}" via ${e.bin}.`);
      break;
    }
    const mount = e.absoluteMount ? resolve(MCP_ROOT, STORAGE) : STORAGE;
    console.log(`Creating "${NAME}" via ${e.bin} (storage: ${mount})...`);
    const r = sh([...e.run, '-d', '-p', '6333:6333', '-p', '6334:6334', '-v', `${mount}:/qdrant/storage`, '--name', NAME, IMAGE]);
    process.exit(r.status ?? 1);
  }
  case 'start': process.exit(sh([...e.start, NAME]).status ?? 1);
  case 'stop':  process.exit(sh([...e.stop, NAME]).status ?? 1);
  case 'rm':    process.exit(sh([...e.rm, NAME]).status ?? 1);
  case 'logs':  process.exit(sh([...e.logs, NAME]).status ?? 1);
  case 'status': {
    console.log(`engine:    ${engineName}${e.external ? ' (lifecycle managed outside this workspace)' : ` (${e.bin})`}`);
    console.log(`endpoint:  ${URL}`);
    console.log(`reachable: ${(await healthy()) ? 'yes' : 'NO'}`);
    if (!e.external) {
      console.log(`\nContainers named "${NAME}":`);
      sh([...e.ps, '--filter', `name=${NAME}`]);
    }
    console.log('\nIndex health: yarn docs:health');
    break;
  }
  default:
    console.error(`Unknown command "${cmd}". Use: up | start | stop | rm | logs | status`);
    process.exit(2);
}
