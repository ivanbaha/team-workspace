export const docsToolSchemas = [
  {
    name: 'docs_map',
    description:
      'Return a structured outline (table of contents) of the team documentation under docs/: ' +
      'every markdown file with its title, a one-line summary, and its H2/H3 sections ' +
      '(full heading path, line range, and a short summary each). ' +
      'Use this FIRST to locate which doc/section is relevant, then read the full file at the ' +
      'given path and line range. Optionally pass a filter to only return files whose title, ' +
      'path, section headings or summaries contain the substring.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Optional case-insensitive substring to narrow results (matches file title, path, ' +
            'section headings and summaries).',
        },
      },
    },
  },
];

export const docsSearchToolSchemas = [
  {
    name: 'docs_search',
    description:
      'Hybrid semantic + keyword search over the Workspace knowledge base: team docs (docs/), ' +
      'lib/infra READMEs, and other curated markdown ' +
      'across the workspace. Returns the most relevant sections as pointers (workspace-relative ' +
      'file path, heading, line range, snippet, fused score) so you can then read the full file. ' +
      'Combines dense embeddings (meaning) with BM25 (exact identifiers like role:workspace:team_lead). ' +
      'Opt-in: only available when DOCS_SEARCH_ENABLED=true and the index has been built.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language or keyword query, e.g. "how does M2M authentication work".',
        },
        limit: {
          type: 'number',
          description: 'Max number of sections to return (default 5, max 20).',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
];
