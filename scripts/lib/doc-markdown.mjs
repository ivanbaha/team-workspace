/**
 * The single definition of "a documentation markdown file worth reindexing for".
 *
 * Shared by the git hooks and the workspace setup scripts so the change-detection
 * rule cannot drift between them — a hook that reindexes for a file the setup
 * ignores (or vice versa) is a bug nobody notices until they measure it.
 */

/**
 * CHANGELOG.md is excluded at any depth, case-insensitively. Release tooling
 * rewrites changelogs on every pipeline, so including them means roughly every
 * pull triggers a multi-minute rebuild for content nobody ever searches.
 */
export function isDocMarkdown(file) {
  const lower = file.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  if (lower === 'changelog.md' || lower.endsWith('/changelog.md')) return false;
  return true;
}

/** True if any path in the list is documentation markdown. */
export const hasDocMarkdown = (files) => files.some(isDocMarkdown);
