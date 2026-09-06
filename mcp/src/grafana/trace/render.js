/**
 * Rendering a reconstructed trace for humans: a Mermaid sequence diagram and a Markdown report.
 *
 * The report is written to a file rather than returned to the agent, because a busy trace is
 * thousands of lines and none of it belongs in a context window. The agent gets `summarize()`.
 */

const alias = (name, index) => `P${index}`;

function buildAliases(edges) {
  const names = new Set();
  for (const edge of edges) {
    names.add(edge.from);
    names.add(edge.to);
  }
  return new Map([...names].map((name, index) => [name, alias(name, index)]));
}

function formatCallLabel(edge) {
  const statuses = [...new Set(edge.calls.map((call) => call.statusCode ?? '?'))].join('/');
  const durations = edge.calls.map((call) => call.duration).filter((value) => typeof value === 'number');
  const timing = durations.length > 0 ? `, ${Math.max(...durations)}ms` : '';
  return `${statuses}${timing}`;
}

/** A Mermaid sequence diagram of the reconstructed edges, ready to paste into a ticket. */
export function renderMermaid(edges) {
  if (edges.length === 0) return '```mermaid\nsequenceDiagram\n  Note over Unknown: no request spans found\n```';

  const aliases = buildAliases(edges);
  const lines = ['```mermaid', 'sequenceDiagram', '  autonumber'];

  for (const [name, id] of aliases) lines.push(`  participant ${id} as ${name}`);

  for (const edge of edges) {
    const from = aliases.get(edge.from);
    const to = aliases.get(edge.to);
    const call = `${edge.method ?? '?'} ${edge.path ?? '?'}`;
    lines.push(`  ${from}->>${to}: ${call}${edge.calls.length > 1 ? ` (x${edge.calls.length})` : ''}`);
    lines.push(`  ${to}-->>${from}: ${formatCallLabel(edge)}`);
  }

  lines.push('```');
  return lines.join('\n');
}

function renderTree(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const status = node.statusCode ?? '—';
    const duration = typeof node.duration === 'number' ? `${node.duration}ms` : '—';
    const flags = [
      node.ambiguous ? 'ambiguous' : null,
      node.unterminated ? 'UNTERMINATED' : null,
      node.orphanedResponse ? 'response-only' : null,
    ].filter(Boolean);
    lines.push(
      `${indent}- ${node.service}  ${node.method} ${node.path}  (${status}, ${duration})` +
        (flags.length ? `  [${flags.join(', ')}]` : ''),
    );
    lines.push(...renderTree(node.children, depth + 1));
  }
  return lines;
}

/** The full Markdown report. */
export function renderReport(trace) {
  const { traceId, environment, spans, edges, tree, coverage, problems, repeated, wallTimeMs } = trace;

  const lines = [
    `# Trace ${traceId}`,
    '',
    `- **Environment:** ${environment}`,
    `- **Spans:** ${spans.length}`,
    `- **Services:** ${coverage.traced.length} traced, ${coverage.gaps.length} gap(s)`,
    `- **Wall time:** ${wallTimeMs === undefined ? 'unknown' : `${wallTimeMs}ms`}`,
    '',
    '## Call chain',
    '',
    renderMermaid(edges),
    '',
    '## Call tree',
    '',
    ...(tree.length ? renderTree(tree) : ['_No request logs found — see coverage below._']),
    '',
    '## Coverage',
    '',
    `- **Traced:** ${coverage.traced.join(', ') || '—'}`,
    `- **Gaps:** ${coverage.gaps.join(', ') || 'none'}`,
    `- **External callers:** ${coverage.externalCallers.join(', ') || 'none'}`,
    '',
    '> A gap means the service emitted no request logs, **not** that it was skipped. Usually it has',
    '> not adopted `@tw/logger`, is running below `info` level, or is not ours.',
    '',
  ];

  if (repeated.length > 0) {
    lines.push('## Repeated calls', '');
    for (const item of repeated) {
      lines.push(`- ${item.from} → ${item.to}  \`${item.call}\`  ×${item.count}`);
    }
    lines.push('', '> Reported, not diagnosed: this is either cache misses or duplicated work.', '');
  }

  if (problems.length > 0) {
    lines.push('## Errors and warnings', '');
    for (const problem of problems) {
      lines.push(`- \`${problem.timestamp}\` **${problem.level}** ${problem.service} [${problem.context ?? ''}] — ${problem.message}`);
    }
    lines.push('');
  }

  lines.push('## Spans', '', '| # | Service | Call | Status | Duration | Caller | Flags |', '|---|---|---|---|---|---|---|');
  spans.forEach((span, index) => {
    const flags = [
      span.paired ? null : 'unpaired',
      span.ambiguous ? 'ambiguous' : null,
      span.unterminated ? 'unterminated' : null,
    ].filter(Boolean).join(', ');
    lines.push(
      `| ${index + 1} | ${span.service} | ${span.method} ${span.path} | ${span.statusCode ?? '—'} | ` +
        `${typeof span.duration === 'number' ? `${span.duration}ms` : '—'} | ${span.caller ?? '—'} | ${flags || '—'} |`,
    );
  });

  return lines.join('\n') + '\n';
}
