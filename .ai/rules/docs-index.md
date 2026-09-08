# Finding Things — Search Before You Build

`docs_search` is the **default first move for any non-trivial task**, not just for
documentation questions. Run it before writing a script, before reasoning about
architecture, and before falling back to `grep`.

Rediscovering something the team already solved and wrote down is the expensive failure
mode here.

---

## The two navigation tools

- **`docs_search`** — the primary tool. Hybrid semantic + keyword search across the curated
  corpus. Works for concrete questions (*"how does the checkout flow handle a failed
  payment?"*) as well as exact tokens (an env var, a header name, a role value). Usually one
  call to the answer.
- **`docs_map`** — fallback. Returns the table of contents of `docs/` — every file, its
  sections, their line ranges. Reach for it when `docs_search` is unavailable, when its
  results look off-target, or when you genuinely want to browse the structure rather than
  answer a question.

**Both return pointers, not prose** — file path, heading path, line range, snippet. Neither
answers the question. **Read the real file at the returned lines.** That is what keeps the
retrieval layer debuggable and free of the summarise-then-hallucinate failure mode.

If neither tool is available, fall back to `grep` — but say that you did, because the answer
is then only as good as the words you guessed.

---

## Search the problem, not the filename

The index covers `docs/`, service and library READMEs, `infra/`, `configs/`, `scripts/` and
the connector docs under `.ai/`. So it is how you discover:

- **Existing tooling.** There is very likely already a script for what you are about to
  hand-roll. Search the *problem*: "rebuild the docs index", "clone all repos", "trace one
  request across services", "check which version is in test".
- **Prior work on the same problem** — a guide or an incident write-up may already record
  the decision, the gotchas and the commands.
- **Conventions, env vars, service relations** — the original purpose.

Do not write a throwaway script, invent a procedure, or start a broad `grep` sweep until a
`docs_search` for the problem has come back empty.

---

## Quick map

| Looking for | Start at |
| --- | --- |
| How work flows — phases, owners, hand-offs | `docs/sdlc/README.md` |
| What to do with a ticket you just picked up | `docs/guides/sdlc-quickstart.md` |
| How much process a piece of work earns | [`work-triage.md`](./work-triage.md) |
| A feature spec, or the spec template | `docs/SPECs/` — **not searchable, open it by path** |
| A one-page plan for small work | `docs/tasks/` — **not searchable, open it by path** |
| System architecture, patterns, conventions | `docs/architecture/README.md` |
| How a request is followed across services | `docs/architecture/distributed-tracing.md`, `docs/guides/tracing-a-request.md` |
| Business flows from the user's perspective | `docs/business/README.md` |
| Onboarding, tool setup, runbooks | `docs/guides/README.md` |
| What is deployed where, and how it got there | `infra/git-ops/README.md` |
| Release-window runbooks | `docs/release/README.md` |
| Security / production incidents | `docs/incidents/README.md` |
| One-off investigations and audits | `docs/spikes/README.md` |
| How the search index is built and curated | `docs/architecture/docs-rag.md`, `mcp/src/docs/sources.js` |
| Skills available to the agent | `.ai/skills/README.md` |
| The rules themselves | `CONTRIBUTING.md` |

---

## Keeping the index current

`docs_search` answers from the last ingest. **A file added or rewritten since then is
invisible to it.**

`yarn setup` and the daily guard refresh the index in the normal flow, and a `git pull` that
brings changed documentation triggers a background rebuild.

**The agent must not run `yarn docs:ingest` itself** (see
[local-environment.md](./local-environment.md)). After adding or materially changing any
indexed markdown, say plainly that the index is stale for that file so the operator can
refresh it when convenient. A `PostToolUse` hook
(`scripts/hooks/docs-index-staleness.mjs`) prints this notice automatically, but the hook is
a reminder, not a substitute for saying so in your summary.

---

## What is deliberately *not* indexed

`docs/SPECs/`, `docs/tasks/`, `.ai/skills/` and `.ai/rules/` are excluded on purpose.

Specifications and task one-pagers describe **intent**; the rest of `docs/` describes
**reality**. Retrieval has no notion of "planned" versus "shipped", so a spec for an unbuilt
feature reads exactly like documentation of a working one — a wrong answer delivered
confidently. Skills and rules are
**instructions addressed to an agent**, already delivered by the agent runtime; indexing
them adds a second, worse delivery path where procedural text competes with reference docs
on the domain words it necessarily contains.

They are all still valuable to **read** — read them directly, knowing what they are. So a
`docs_search` that comes back empty on a feature does **not** mean nobody has planned it:
check `docs/SPECs/` and `docs/tasks/` by path before concluding the work is unstarted. The
full reasoning is in the comment block in
[`mcp/src/docs/sources.js`](../../mcp/src/docs/sources.js).
