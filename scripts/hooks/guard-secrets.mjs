#!/usr/bin/env node
/**
 * guard-secrets.mjs — PreToolUse(Bash)
 *
 * Blocks a git command that would stage or commit a credential file, and blocks
 * writing a token-shaped string into the repo from the shell.
 *
 * This workspace keeps every credential in one root `.env` (see example.env), so
 * the file that must never be committed is easy to name — and `git add -A` in a
 * workspace with a dozen nested repos is easy to reach for. A committed token is
 * not undone by a later commit: it has to be rotated, and the history rewritten.
 *
 * A backstop, not a policy. The policy is in .ai/rules/git-workflow.md.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, allow, block, commandOf, readEvent, segments } from './lib/hook-io.mjs';

const SECRET_FILES = [
  /(^|[\s'"/])\.env($|[\s'"])/,          // .env, but not .env.example
  /(^|[\s'"/])\.env\.(local|production)/,
  /\.pem($|[\s'"])/,
  /\.p12($|[\s'"])/,
  /\.pfx($|[\s'"])/,
  /(^|[\s'"/])id_(rsa|ed25519)($|[\s'"])/,
  /\.kube\/config/,
  /credentials\.json/,
];

// Deliberately narrow. A broad "looks like base64" rule fires on lockfile hashes
// and image digests, and a hook that cries wolf gets disabled within a week.
const TOKEN_PATTERNS = [
  { name: 'GitLab PAT', re: /glpat-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitLab service account token', re: /glsa_[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

const event = readEvent();
const command = commandOf(event);
if (!command) allow();

for (const { name, re } of TOKEN_PATTERNS) {
  const hit = command.match(re);
  if (!hit) continue;
  block(
    `BLOCKED: this command contains what looks like a ${name}.\n\n` +
    `  ${hit[0].slice(0, 12)}…\n\n` +
    `Credentials belong in the root .env (git-ignored), never in a command, a file in the\n` +
    `repo, or a commit message. If this is a placeholder for documentation, use an obviously\n` +
    `fake value that does not match a real token shape.`,
  );
}

for (const segment of segments(command)) {
  if (!/^git\s/.test(segment)) continue;
  if (!/\b(add|commit|stash)\b/.test(segment)) continue;

  const matched = SECRET_FILES.find((re) => re.test(segment));
  if (matched) {
    block(
      `BLOCKED: this git command names a credential file.\n\n  ${segment}\n\n` +
      `Credential files are git-ignored on purpose. If the file genuinely needs to be tracked,\n` +
      `it is the wrong file — add a redacted \`.example\` version instead (see example.env).`,
    );
  }

  // `git add -A` / `git add .` stages whatever is present. That is normally fine,
  // and only worth refusing when an untracked .env is actually sitting there.
  if (/\bgit\s+add\b/.test(segment) && /(\s-A\b|\s--all\b|\s\.\s*$)/.test(segment)) {
    const exposed = ['.env', '.env.local', '.env.production'].filter((f) => existsSync(join(ROOT, f)));
    if (exposed.length) {
      block(
        `BLOCKED: \`${segment}\` would stage everything, and ${exposed.join(', ')} is present in the\n` +
        `workspace root.\n\n` +
        `It should be covered by .gitignore — but a bulk add is not the place to find out.\n` +
        `Stage the paths you actually changed instead:\n\n  git add <path> [<path> …]`,
      );
    }
  }
}

allow();
