/**
 * Heading-aware markdown chunker for hybrid search ingestion.
 *
 * Rules tuned for the workspace docs corpus (table- and identifier-heavy):
 *   - Split on markdown headings so each chunk has a clear topic.
 *   - Tables and code fences are ATOMIC — never split mid-table or mid-fence.
 *     A half-table chunk reads as complete and is the worst failure mode for a
 *     docs assistant.
 *   - Oversized sections sub-split on paragraph boundaries only.
 *   - The full heading path (H1 > H2 > H3) is attached to every chunk so a
 *     short paragraph still carries topical context into its embedding.
 */

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

const TARGET_MAX = Number(process.env.DOCS_RAG_CHUNK_MAX || 1000);

/**
 * @param {string} content raw markdown
 * @param {string} filePath path relative to docs root, e.g. "architecture/authentication.md"
 * @returns {Array<{filePath:string, headingPath:string, text:string, startLine:number, endLine:number}>}
 */
export function chunkMarkdown(content, filePath) {
  const lines = content.split(/\r?\n/);
  return assemble(segmentize(lines), filePath);
}

/** Break the document into atomic segments: heading | code | table | paragraph. */
function segmentize(lines) {
  const segs = [];
  const n = lines.length;
  let i = 0;

  while (i < n) {
    const line = lines[i];

    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1];
      const start = i;
      const buf = [line];
      i++;
      while (i < n && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i]);
        i++;
      }
      if (i < n) {
        buf.push(lines[i]);
        i++;
      }
      segs.push({ type: 'code', text: buf.join('\n'), startLine: start + 1, endLine: i });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      segs.push({
        type: 'heading',
        level: heading[1].length,
        title: heading[2].trim(),
        startLine: i + 1,
        endLine: i + 1,
      });
      i++;
      continue;
    }

    if (line.trim() !== '' && line.includes('|')) {
      const start = i;
      const buf = [];
      while (i < n && lines[i].trim() !== '' && lines[i].includes('|')) {
        buf.push(lines[i]);
        i++;
      }
      segs.push({ type: 'table', text: buf.join('\n'), startLine: start + 1, endLine: i });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const start = i;
    const buf = [];
    while (i < n) {
      const l = lines[i];
      if (l.trim() === '' || HEADING_RE.test(l) || FENCE_RE.test(l) || l.includes('|')) break;
      buf.push(l);
      i++;
    }
    segs.push({ type: 'para', text: buf.join('\n'), startLine: start + 1, endLine: i });
  }

  return segs;
}

/** Walk segments, track the heading stack, emit chunks. */
function assemble(segments, filePath) {
  const chunks = [];
  const stack = [];
  let cur = null;

  const headingPath = () => stack.filter(Boolean).join(' > ') || filePath;
  const startChunk = (startLine) => {
    cur = { parts: [], startLine, endLine: startLine, headingPath: headingPath() };
  };
  const size = () => (cur ? cur.parts.join('\n\n').length : 0);
  const flush = () => {
    if (cur) {
      const text = cur.parts.join('\n\n').trim();
      if (text) {
        chunks.push({
          filePath,
          headingPath: cur.headingPath,
          text,
          startLine: cur.startLine,
          endLine: cur.endLine,
        });
      }
    }
    cur = null;
  };

  for (const seg of segments) {
    if (seg.type === 'heading') {
      flush();
      stack[seg.level] = seg.title;
      stack.length = seg.level + 1;
      startChunk(seg.startLine);
      continue;
    }

    if (!cur) startChunk(seg.startLine);

    // Continue into a new chunk if a paragraph would overflow the target.
    // Tables/code are always kept whole, even if that exceeds the cap.
    if (seg.type === 'para' && size() > 0 && size() + seg.text.length > TARGET_MAX) {
      const path = cur.headingPath;
      flush();
      startChunk(seg.startLine);
      cur.headingPath = path;
    }

    cur.parts.push(seg.text);
    cur.endLine = seg.endLine;
  }

  flush();
  return chunks;
}
