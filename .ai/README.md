# .ai — Agent-Neutral Skills & Connectors

This directory contains **shared AI agent resources** that are not tied to any specific coding tool.
The same skills and connectors work with Kiro, Cursor, GitHub Copilot, Antigravity, or any other
agent that can read markdown and execute shell commands.

## Structure

```txt
.ai/
├── connectors/                  # Standalone Node.js scripts for external service access
│   ├── env.json                 # ⚠ Credentials for ALL connectors — gitignored, never commit
│   ├── env.json.example         # Safe template to commit and share with teammates
│   ├── grafana/                 # Grafana/Loki log search
│   │   ├── config.mjs           # Shared config loader (reads env.json)
│   │   ├── get-available.mjs    # Lists configured environments / checks connectivity
│   │   └── search-logs.mjs      # Queries Loki logs for a given environment
│   ├── gitlab/                  # GitLab API (MRs, projects, reviews, push)
│   │   └── README.md
│   ├── jira/                    # Jira API (issue get/create, attachments)
│   │   └── README.md
│   └── mongodb/                 # MongoDB queries (find, aggregate, count)
│       └── README.md
└── skills/                      # Agent-neutral skill definitions (pure markdown, no frontmatter)
    └── debug-and-report/
        └── SKILL.md             # Debug production issues and create Jira bug reports
```

## Credentials — env.json

`connectors/env.json` holds PATs and connection strings for all connectors (Grafana, GitLab, Jira, MongoDB).

**It must never be committed.** It is listed in `.ai/connectors/.gitignore`.

Use `connectors/env.json.example` as a template — it contains the expected shape with placeholder values.

## Connectors

Each connector is a self-contained Node.js `.mjs` script. No build step, no dependencies beyond Node 18+.
Run them directly:

```bash
node .ai/connectors/grafana/get-available.mjs
node .ai/connectors/grafana/search-logs.mjs --env uat --service my-service --search "error"
```

All connectors output JSON to stdout and errors to stderr.

## Skills

Skills are plain markdown files with step-by-step instructions for the AI agent.
They reference connectors by path so any agent that can run shell commands can follow them.

Each coding tool wraps the canonical skill with its own thin adapter:

| Tool               | Wrapper location                            | How to invoke                                        |
| ------------------ | ------------------------------------------- | ---------------------------------------------------- |
| **Antigravity**    | `.agents/skills/<skill-name>/SKILL.md`      | Automatic — Antigravity reads `.agents/skills/`      |
| **Kiro**           | `.kiro/skills/<skill-name>/SKILL.md`        | Automatic — Kiro reads `.kiro/skills/`               |
| **GitHub Copilot** | `.github/skills/<skill-name>/SKILL.md`      | Automatic — Copilot agent picks up `.github/skills/` |
| **Claude Code**    | `.claude/commands/<skill-name>.md`          | `/project:<skill-name>` slash command                |
| **Cursor**         | `.cursor/rules/<skill-name>.md`             | Mention in chat or attach as a rule                  |

The canonical source of truth always lives here in `.ai/skills/`.

## Adding a New Skill

1. Create `.ai/skills/<skill-name>/SKILL.md` with plain markdown instructions.
2. Add a thin wrapper in each agent's config directory pointing back to the canonical file.
3. Document the skill in the table above.

## Adding a New Connector

1. Create `.ai/connectors/<service>/` with your `.mjs` scripts.
2. Add credentials shape to `connectors/env.json.example`.
3. Document the connector in the structure above.
