---
name: release-mr
description: "Prepare a release merge request that promotes service versions between environments in infra/git-ops — dev → test, or test → prod. Reads the pinned versions from the source overlay, reports the version and configuration deltas for approval, writes the target overlay, validates that every overlay still builds, and opens the MR on a release/* branch. Use when the user says 'cut a release', 'promote to test', 'prepare the prod release', 'release MR', or names a release version."
---

<!-- GENERATED FILE — DO NOT EDIT. Run `yarn skills:sync`. -->
<!-- Antigravity wrapper — the canonical skill is agent-neutral. -->

The full instructions live in the canonical file. Follow them exactly, from Step 1:

[.ai/skills/release-mr/SKILL.md](../../../.ai/skills/release-mr/SKILL.md)
