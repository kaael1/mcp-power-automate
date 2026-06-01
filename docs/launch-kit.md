# Launch Kit

English-first launch and growth material for `kaael1/mcp-power-automate`.

## Positioning

Primary positioning:

> Local-first MCP for Microsoft Power Automate with browser-backed auth, explicit target locking, validation, review diff, and rollback.

Secondary positioning:

> Let AI agents work on real Power Automate flows through your existing Chromium session, without starting with a Microsoft Entra app registration.

## Traction Snapshot

Use dated traction when it helps a post or marketplace submission feel alive, but refresh numbers before reusing them publicly.

- LinkedIn launch post: 15,000+ views.
- GitHub stars: 14.
- Audience signal: MCP users, AI-agent builders, Power Platform makers, and operators who want safer flow automation.

## Core Proof Points

1. No Microsoft Entra ID app registration is required to get started.
2. Explicit target flow selection reduces wrong-tab and stale-context mistakes.
3. Preview, validation, review diff, and one-step revert make real edits less scary.
4. Runs and action-level failures can be inspected from the MCP client.
5. The project ships one local MCP runtime, one Chromium extension, and one reusable skill bundle.

## Directory Copy

### Short

Local-first MCP for Microsoft Power Automate with browser-backed auth and safer flow edits.

### Medium

Local MCP server and Chromium extension for Microsoft Power Automate with browser-backed auth, explicit target locking, validation, review diff, run inspection, and rollback.

### Long

Operate Microsoft Power Automate flows from MCP clients using your existing logged-in Chromium session. This repo provides explicit target flow selection, flow reads and updates, validation, run inspection, post-save review diff, and one-step rollback without requiring Microsoft Entra app registration to get started.

## Suggested Tags

- MCP
- Power Automate
- Microsoft
- Power Platform
- workflow automation
- browser-backed auth
- local-first
- AI agents
- Codex
- Claude Code

## Suggested GitHub Repo Metadata

Repository description:

> Local MCP for Microsoft Power Automate with browser-backed auth, explicit target locking, safer flow edits, review diff, and rollback.

Suggested topics:

- `mcp`
- `model-context-protocol`
- `power-automate`
- `power-platform`
- `workflow-automation`
- `browser-extension`
- `browser-auth`
- `codex`
- `claude-code`
- `ai-agents`

## Visuals

Primary README cover:

- Source path: `assets/readme-cover.png`
- Purpose: GitHub README, social cards, launch posts, and marketplace submissions.
- Message: `Inspect. Validate. Edit. Revert.`

Keep the cover as a bitmap asset so the public README matches the social launch visual. If a provider requires landscape artwork, crop from the right-side title and agent panel before shrinking text.

## GitHub Release Notes Template

Title:

`v1.x.x - safer Power Automate operations for MCP agents`

Body:

```md
## What changed

- refreshed README positioning and launch visuals
- clarified the local-first browser-backed setup path
- tightened the recommended inspect -> preview -> validate -> save -> review -> revert workflow
- synced skill and provider guidance with the public v1 command surface

## Why this matters

This repo is for MCP users who want to do real Power Automate work without getting blocked by enterprise auth setup, wrong-tab edits, or blind saves.

## Install

### MCP

codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate

### Skill

npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

## Launch Post - Long Form

```text
I shipped MCP Power Automate: a local MCP server + Chromium extension + Codex skill for working with Microsoft Power Automate flows through your existing logged-in browser session.

The main thing I wanted to remove was setup pain.

You do not need to provision a Microsoft Entra app registration just to get started.
You can explicitly lock the MCP onto a target flow instead of blindly following whatever tab is active.
And after a save, the MCP can show a structured review diff and keep one-step rollback history.

What it can do today:
- list flows in the current environment
- set an explicit active target flow
- read, validate, update, and clone flows
- inspect runs and action-level failures
- trigger manual/request flows
- review and revert the last saved change
- add cloud flows to unmanaged Dataverse solutions

Repo:
https://github.com/kaael1/mcp-power-automate

Install the MCP:
codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate

Install the skill:
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

## Launch Post - Short

```text
Built a local-first MCP for Microsoft Power Automate.

- browser-backed auth
- explicit target flow locking
- validate/update/test flows
- run and action-level inspection
- saved-change review diff
- one-step rollback
- no Microsoft Entra app registration required to get started

Repo: https://github.com/kaael1/mcp-power-automate
Skill: npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
MCP: codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate
```

## Community Angles

- MCP directories: emphasize protocol compatibility, local stdio install, and real-world usefulness.
- Codex and Claude Code users: emphasize the skill bundle plus safer flow editing.
- Power Automate communities: emphasize no-Entra-setup onboarding and supervised edits.
- Power Platform admins: emphasize explicit target locking, validation, review diff, and scoped solution writes.

## Demo Storyboard

30-second capture sequence:

1. Show a Power Automate flow open in the browser.
2. Show the MCP install command.
3. Show `doctor`, `get_context`, and `connect_flow`.
4. Show `preview_flow_update` for a small flow update.
5. Show `validate_flow` and `apply_flow_update`.
6. Show `get_last_update` with a readable diff.
7. Show `revert_last_update` as the recovery path.

The demo should make three things visually obvious:

- no custom enterprise auth setup
- explicit target control
- safer change review than a blind save
