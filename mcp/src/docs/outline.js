/**
 * Markdown outline parser for the `docs_map` tool.
 *
 * Produces a compact table-of-contents view of a doc: its title, a one-line
 * summary, and its H2/H3 sections (full heading path, line range, short
 * summary). Headings inside fenced code blocks are ignored so a ```bash block
 * containing `# comment` is never mistaken for a heading.
 */

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const TABLE_SEP_RE = /^[|:\-\s]+$/;

const MAX_SUMMARY = 160;
const MIN_LEVEL = 2;
const MAX_LEVEL = Number(process.env.DOCS_MAP_MAX_HEADING_LEVEL || 3);

/**
 * @param {string} content raw markdown
 * @param {string} filePath path used in the output (e.g. "docs/architecture/authentication.md")
 * @returns {{path:string, title:string, summary:string, sections:Array<{heading:string, lines:string, summary:string}>}}
 */
export function outlineMarkdown(content, filePath) {
  const lines = content.split(/\r?\n/);
  const headings = collectHeadings(lines);

  const h1 = headings.find((h) => h.level === 1);
  const title = h1 ? h1.title : filePath.split('/').pop().replace(/\.md$/i, '');

  const stack = [];
  const sections = [];
  for (let idx = 0; idx < headings.length; idx++) {
    const h = headings[idx];
    stack[h.level] = h.title;
    stack.length = h.level + 1; // drop deeper levels

    if (h.level < MIN_LEVEL || h.level > MAX_LEVEL) continue;

    // End the section at the next heading of the same or higher level, so a
    // parent heading's range spans all of its subsections (overlapping with the
    // child ranges is intentional — either is useful to read).
    let endLine = lines.length;
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        endLine = headings[j].line;
        break;
      }
    }

    sections.push({
      heading: stack.filter(Boolean).join(' > '),
      lines: `${h.line + 1}-${endLine}`,
      summary: firstContentLine(lines, h.line + 1, endLine),
    });
  }

  const fileSummary = firstContentLine(lines, h1 ? h1.line + 1 : 0, lines.length);
  return { path: filePath, title, summary: fileSummary, sections };
}

/** Collect headings (0-based line index), skipping anything inside code fences. */
function collectHeadings(lines) {
  const headings = [];
  let inFence = false;
  let marker = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      if (!inFence) {
        inFence = true;
        marker = fence[1];
      } else if (line.trim().startsWith(marker)) {
        inFence = false;
        marker = null;
      }
      continue;
    }
    if (inFence) continue;

    const m = line.match(HEADING_RE);
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), line: i });
  }
  return headings;
}

/** First meaningful line in [from, to): not blank, heading, fence, or table separator. */
function firstContentLine(lines, from, to) {
  let inFence = false;
  let marker = null;

  for (let i = from; i < to && i < lines.length; i++) {
    const raw = lines[i];
    const fence = raw.match(FENCE_RE);
    if (fence) {
      if (!inFence) {
        inFence = true;
        marker = fence[1];
      } else if (raw.trim().startsWith(marker)) {
        inFence = false;
        marker = null;
      }
      continue;
    }
    if (inFence) continue;

    const t = raw.trim();
    if (t === '' || HEADING_RE.test(raw) || TABLE_SEP_RE.test(t)) continue;

    const cleaned = t
      .replace(/^[-*+]\s+/, '') // list bullet
      .replace(/^>\s?/, '') // blockquote
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;

    return cleaned.length > MAX_SUMMARY ? cleaned.slice(0, MAX_SUMMARY - 1).trimEnd() + '…' : cleaned;
  }
  return '';
}
