# Agent config templates

Templates for MCP clients that **need an absolute path** to the server: they are configured
outside this repository, or their documentation gives no reliable way to point a workspace
file at `mcp/src/index.js` relative to the workspace root. Copy the block into the client's
settings and replace `/REPLACE_WITH_ABSOLUTE_PATH_TO_WORKSPACE` with the absolute path of your
checkout.

| Template | Client | Copy into |
| --- | --- | --- |
| `claude_desktop.json` | Claude Desktop | `claude_desktop_config.json` in the Claude Desktop config folder |
| `cline.json` | Cline / Roo-Code (VS Code) | Cline's MCP settings (`cline_mcp_settings.json`) |
| `kiro.json` | Kiro | `.kiro/settings/mcp.json` (workspace) or `~/.kiro/settings/mcp.json` (user) |

Clients that support a project-scoped file with a path relative to the workspace — Claude
Code, VS Code / GitHub Copilot, Cursor — use the configs committed at the workspace root
instead, and need nothing from here. The per-agent table:
[`.ai/README.md`](../../.ai/README.md#rules-and-skills--one-source-generated-wrappers). Exact
config-file locations per OS: [Connecting to AI Agents](../README.md#connecting-to-ai-agents).
