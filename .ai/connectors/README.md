# Connectors

Repo-local Node scripts that reach an external service from the shell. An agent runs one by
path — `node .ai/connectors/<service>/<script>.mjs` — from inside a skill, and a person runs
the same command from a terminal.

Whether a new capability belongs here, in the MCP server, in one skill's `scripts/`, or
nowhere at all is decided by the placement rule in
[Where executable functionality lives](../README.md#where-executable-functionality-lives).
Read that before adding a script here.

---

## The register

| Script | What it does | Called by |
| --- | --- | --- |
| [`grafana/get-available.mjs`](./grafana/README.md) | Lists the configured Grafana environments; `--check` also tests connectivity | [`debug-and-report`](../skills/debug-and-report/SKILL.md) |
| [`grafana/search-logs.mjs`](./grafana/README.md) | Searches Loki log lines by environment, service, text and time range | [`debug-and-report`](../skills/debug-and-report/SKILL.md) |
| [`grafana/trace-id.mjs`](./grafana/README.md) | Traces one Trace-Id across every service and rebuilds the call chain — the CLI face of the `grafana_trace_id` MCP tool, sharing its engine | [`debug-and-report`](../skills/debug-and-report/SKILL.md) |

`grafana/config.mjs` is the shared loader the three scripts import; it is not run on its own.
Per-script options and examples: [`grafana/README.md`](./grafana/README.md).

---

## Running one

```bash
node .ai/connectors/grafana/get-available.mjs --check
node .ai/connectors/grafana/search-logs.mjs --env test --service users-service --search "timeout"
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6EYRY4TFEPR9PHJZ1QHPF --env test
```

- **Node 18+, no dependencies, no build step.** A connector imports only Node built-ins and,
  where it shares an engine with the MCP server, a module from `mcp/src/` — never a package
  that has to be installed first.
- **Credentials come from the root `.env`**, created from [`example.env`](../../example.env) at
  the workspace root. The MCP server reads the same file, so there is one place to rotate a
  token.

## Output contract

Every connector follows the same contract, which is what makes it usable by any agent that
can run a shell command:

- **stdout** is JSON, and only JSON.
- **stderr** carries errors and diagnostics.
- A non-zero exit code means the command failed.

Keeping diagnostics off stdout is not a style preference — an agent parses stdout, so one
stray log line there turns a successful call into a parse error.

---

## Adding one

Only when the [placement rule](../README.md#where-executable-functionality-lives) says so.
The steps are in [Adding a New Connector](../README.md#adding-a-new-connector); the last of
them is a row in the register above.
