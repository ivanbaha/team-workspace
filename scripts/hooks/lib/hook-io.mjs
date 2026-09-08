/**
 * Hook plumbing, shared by every hook in this directory.
 *
 * An agent runs a hook as a subprocess: the event arrives as JSON on stdin, and
 * the hook answers through its exit code. That contract is small enough to be
 * portable — these hooks are wired for Claude Code in .claude/settings.json, and
 * anything that can run a command on a tool event can use the same scripts.
 *
 * Exit codes:
 *   0  allow, silently
 *   2  block (PreToolUse) or feed stderr back to the agent (PostToolUse)
 *
 * Everything else is treated as a broken hook and ignored, which is the right
 * default: a hook that fails must not be able to wedge the session.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

/** The event payload, or an empty object when there is nothing readable on stdin. */
export function readEvent() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Refuse the call. `reason` is shown to the agent, so say what to do instead. */
export function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** Tell the agent something without refusing anything. */
export function notify(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export const allow = () => process.exit(0);

/**
 * The command a Bash tool call is about to run, normalised for matching:
 * line continuations folded, runs of whitespace collapsed.
 */
export const commandOf = (event) =>
  String(event?.tool_input?.command ?? '').replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();

/** The path an Edit/Write tool call targets, relative to the workspace root. */
export function filePathOf(event) {
  const p = event?.tool_input?.file_path ?? event?.tool_input?.path;
  if (!p) return null;
  return String(p).startsWith(ROOT) ? String(p).slice(ROOT.length + 1) : String(p);
}

/** Split a shell command on the operators that start a new command. */
export const segments = (command) =>
  command.split(/(?:&&|\|\||;|\||\n)/).map((s) => s.trim()).filter(Boolean);
