<!--
  TEMPLATE — do not fill this file in for yourself.

  Copy it, then edit the copy:

      cp .ai/whoami.example.md .ai/whoami.md

  `.ai/whoami.md` is git-ignored and per-person. It is never shared through this repo.
-->

# Current Operator

Identifies whoever is operating this workspace, so an agent can attribute work correctly
and know which parts of a staged artifact are theirs to write.

**Nothing loads this automatically.** It is read on demand by the skills that need it —
[`author-spec`](./skills/author-spec/SKILL.md) uses the role to choose which spec stage you
are in, and [`implement-task`](./skills/implement-task/SKILL.md) uses the name to stamp a
spec's Progress table. Without it, those skills fall back to `git config user.name` and
**ask** which role you are acting in, which is a fine outcome — this file just saves the
question.

## Me

- **Name:** <Your Name>
- **Role:** <BA / PO · Architect · Developer · Manual QA · AQA>
- **Email:** <your.email@example.com>
- **Git host user:** <username or user id>

> One person often holds several of these roles, and the role can differ per feature — you
> may be the architect on one and the implementer on the next. Put the one you hold most
> often here, and correct the agent when a particular piece of work is the other.
>
> The roles themselves are defined in [`docs/sdlc/README.md`](../docs/sdlc/README.md#roles).
