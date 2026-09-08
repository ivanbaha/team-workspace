#!/usr/bin/env node
/**
 * docs-delivery-gate.mjs — PostToolUse(Bash | *safe_push*)
 *
 * After a push completes, says that the `docs/` deliverable of this task is still
 * outstanding.
 *
 * Documentation is the step that gets skipped, universally, because nothing fails
 * when it is missing: the MR is open, the pipeline is green, the ticket looks done.
 * It is also the step with the shortest useful window — docs written a week later
 * are written from memory, by which point the non-obvious decision (the one worth
 * recording) is exactly what has been forgotten.
 *
 * Team docs live in THIS repo; the code lives in a service repo with its own remote.
 * So docs can never ride in the service MR — they are their own commit here, and
 * that separation is precisely why they get dropped.
 *
 * The hook reports; it never blocks. A push that has already happened cannot be
 * un-pushed by refusing it, and a gate that blocks delivery over documentation gets
 * switched off inside a week.
 *
 * See docs/sdlc/03-development.md#docs-delivery.
 */

import { ROOT, allow, commandOf, notify, readEvent } from './lib/hook-io.mjs';

const event = readEvent();
const toolName = String(event?.tool_name ?? '');
const command = commandOf(event);

/**
 * Did this call actually push anything?
 *
 * Two shapes reach us: the MCP push tool (whose name ends in `safe_push`, prefixed
 * differently by each agent), and a raw `git push` that got through — the
 * protected-branch guard only refuses pushes to main, so a feature-branch push via
 * Bash is a real delivery.
 *
 * `--dry-run` is excluded because nothing left the machine.
 */
const isMcpPush = /safe_push/i.test(toolName);
const isGitPush = /\bgit\s+push\b/.test(command) && !/--dry-run\b/.test(command);
if (!isMcpPush && !isGitPush) allow();

/**
 * Was this push the docs delivery itself?
 *
 * If so the step is complete and saying anything would start a loop: the agent
 * pushes docs, gets told to handle docs, pushes again. The signal that works
 * without inspecting the diff is the working directory — a docs commit is pushed
 * from the workspace root, a service commit from somewhere under it.
 *
 * When the directory is absent (the MCP tool defaults to the workspace root), the
 * conservative read is that it was a service push: a redundant reminder costs a
 * sentence, while a missed one costs the documentation.
 */
const workingDir = String(
  event?.tool_input?.working_dir ?? event?.tool_input?.cwd ?? event?.cwd ?? '',
);
const looksLikeWorkspaceRepo =
  workingDir !== '' && (workingDir === ROOT || workingDir === `${ROOT}/`);
if (looksLikeWorkspaceRepo) allow();

notify(
  `A push completed. The DOCS DELIVERABLE for this task is still outstanding.\n` +
  `\n` +
  `Team docs under docs/ live in THIS repo — a different repo from the service you just\n` +
  `pushed — so they never ride in the service MR. They are their own commit here, made now\n` +
  `while the change is fresh.\n` +
  `\n` +
  `  1. Read the "## Docs Impact" section of the task artifact (docs/tasks/<code>.task.md,\n` +
  `     or the spec's design.md).\n` +
  `  2. Reconcile it against what actually shipped — update the docs even if the plan said\n` +
  `     "none", and skip planned edits that the implementation made unnecessary.\n` +
  `  3. Prepare the docs/ edits and PROPOSE committing them. Do NOT auto-push: the operator\n` +
  `     confirms, or commits them by hand.\n` +
  `  4. If there is genuinely no impact, say so explicitly — a conscious "none", not silence.\n` +
  `\n` +
  `If this push WAS the docs delivery, the step is done — say so and take no further action.\n` +
  `This is a reminder to act on docs, not a request to re-run anything.`,
);
