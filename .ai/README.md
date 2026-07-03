# .ai — Agent-Neutral Skills & Connectors

This directory contains **shared AI agent resources** that are not tied to any specific coding tool.
The same skills and connectors work with Kiro, Cursor, GitHub Copilot, Antigravity, or any other
agent that can read markdown and execute shell commands.

## Structure

```txt
.ai/
├── connectors/                  # Standalone Node.js scripts for external service access
│   ├── grafana/                 # Grafana/Loki log search
│   │   ├── config.mjs           # Shared config loader (reads root .env)
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

## Credentials — Root .env

All connectors load their credentials directly from the **root `.env` file** (created from `example.env` at the workspace root). This keeps all API tokens, connection strings, and environments centralised in one place.

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

---

## MCP vs Connectors (Tool Execution Approaches)

This workspace supports two distinct approaches for providing executable tools to AI agents:

1. **Model Context Protocol (MCP) Server**: A persistent stdio server (running under `./mcp`) that exposes tools to the agent directly via the protocol.
2. **Connectors**: Standalone Node.js scripts (running under `.ai/connectors`) executed by the agent via terminal shell commands.

These approaches can be used individually, or simultaneously. To simplify credential management, **both approaches share the root `.env` file** as the single source of truth for secrets, PATs, and API tokens.

### Rule of Thumb: Where to Put Executable Functionality?

When adding a new capability, use the following rules to decide between MCP and Connectors:

* **Definitely a Connector**: If the functionality is used *only once* or is highly specific to a single, isolated skill (e.g., a specific custom migration or script used by a single tutorial).
* **Definitely in the MCP Server**: If the functionality is used *frequently* across many different tasks (e.g., fetching general Jira tickets, querying MongoDB databases, retrying GitLab pipeline jobs).
* **Arguable Cases**: For other cases, decide on a case-by-case basis keeping in mind:
  * *Overloading the MCP*: Permanently consumes the agent's model context window because all active tool schemas are loaded into the LLM system prompt.
  * *Overloading Connectors*: Makes tool discovery and invocation more difficult. The agent has to list directories, parse README instructions, and construct shell commands, which can also consume context and introduce execution errors.

---

## Adding a New Skill

1. Create `.ai/skills/<skill-name>/SKILL.md` with plain markdown instructions.
2. Add a thin wrapper in each agent's config directory pointing back to the canonical file.
3. Document the skill in the table above.

## Adding a New Connector

1. Create `.ai/connectors/<service>/` with your `.mjs` scripts.
2. Add credentials shape to `connectors/env.json.example`.
3. Document the connector in the structure above.
