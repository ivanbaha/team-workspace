#!/usr/bin/env node
/**
 * guard-protected-branch.mjs — PreToolUse(Bash)
 *
 * Blocks a raw `git push` to main/master, and any force push, from the shell.
 *
 * The MCP server already refuses both through `gitlab_safe_push` — it validates
 * branch protections and uses --force-with-lease rather than --force. The gap this
 * closes is the agent shelling out instead of using the tool, which is easy to do
 * and produces exactly the outcome the tool exists to prevent.
 *
 * Rule: .ai/rules/git-workflow.md § Pushing
 */

import { allow, block, commandOf, readEvent, segments } from './lib/hook-io.mjs';

const event = readEvent();
const command = commandOf(event);
if (!command) allow();

const USE_TOOL =
  `Push through the MCP tool instead — it validates branch protections and uses\n` +
  `--force-with-lease when a force is genuinely needed:\n\n` +
  `  gitlab_safe_push { project_id, branch, working_dir }\n\n` +
  `project_id comes from configs/workspace-repos.json. See .ai/rules/git-workflow.md.`;

for (const segment of segments(command)) {
  if (!/^git\s.*\bpush\b/.test(segment)) continue;

  if (/\s(--force|-f)(\s|$)/.test(segment) && !/--force-with-lease/.test(segment)) {
    block(`BLOCKED: force push.\n\n  ${segment}\n\n${USE_TOOL}`);
  }

  // `git push origin main`, `git push origin HEAD:main`, `git push origin +main`.
  // A branch merely *named* like main-something is not a match.
  if (/\bpush\b[^|;]*\s\+?(?:[\w./-]+:)?(main|master)(\s|$)/.test(segment)) {
    block(
      `BLOCKED: direct push to a protected branch.\n\n  ${segment}\n\n` +
      `Work goes to main through a merge request, never a direct push.\n\n${USE_TOOL}`,
    );
  }

  // A bare `git push` on main is the same thing with the branch left implicit,
  // which is how it usually happens.
  if (/^git(\s+-C\s+\S+)?\s+push\s*$/.test(segment)) {
    block(
      `BLOCKED: bare \`git push\` — the target branch is implicit, so this may well be main.\n\n` +
      `${USE_TOOL}`,
    );
  }
}

allow();
