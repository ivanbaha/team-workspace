import { readdirSync, readFileSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { outlineMarkdown } from './outline.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/src/docs -> mcp/src -> mcp -> <workspace root> -> docs
const DEFAULT_DOCS_ROOT = join(__dirname, '..', '..', '..', 'docs');

export class DocsTools {
  constructor(config = {}) {
    this.docsRoot = config.docsRoot || process.env.DOCS_RAG_PATH || DEFAULT_DOCS_ROOT;
  }

  async initialize() {
    logger.info(`Initialized Docs tools (root: ${this.docsRoot})`);
  }

  createResponse(success, data = null, message = '') {
    return { success, data, message };
  }

  /**
   * Build the documentation outline (table of contents). Optionally narrowed by
   * a case-insensitive substring matched against file title/path and section
   * headings/summaries.
   */
  getMap(filter) {
    try {
      const files = walkMarkdown(this.docsRoot);
      const needle = filter && filter.trim() ? filter.trim().toLowerCase() : null;

      const outlines = [];
      let totalSections = 0;

      for (const abs of files) {
        const rel = 'docs/' + relative(this.docsRoot, abs).split(sep).join('/');
        const outline = outlineMarkdown(readFileSync(abs, 'utf8'), rel);
        totalSections += outline.sections.length;
        if (needle && !matchesFilter(outline, needle)) continue;
        outlines.push(outline);
      }

      const message = needle
        ? `${outlines.length} file(s) match "${filter}"`
        : `${outlines.length} files, ${totalSections} sections indexed`;

      return this.createResponse(true, { files: outlines }, message);
    } catch (error) {
      logger.error('docs_map failed:', error.message);
      return this.createResponse(false, null, error.message);
    }
  }
}

function walkMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing/unreadable dir -> skip
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function matchesFilter(outline, needle) {
  if (outline.title.toLowerCase().includes(needle)) return true;
  if (outline.path.toLowerCase().includes(needle)) return true;
  if (outline.summary.toLowerCase().includes(needle)) return true;
  return outline.sections.some(
    (s) => s.heading.toLowerCase().includes(needle) || s.summary.toLowerCase().includes(needle)
  );
}
