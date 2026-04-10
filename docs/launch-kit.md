# Launch Kit

English-first launch materials for growing `kaael1/mcp-power-automate` among MCP power users.

## Positioning

Primary positioning:

> A local MCP for Microsoft Power Automate with browser-backed auth, explicit target locking, safer edits, review diff, and rollback.

Secondary positioning:

> Use AI agents on real Power Automate flows without setting up a Microsoft Entra app registration first.

## Core proof points

1. No Microsoft Entra ID app registration required
2. Explicit target flow selection avoids tab confusion
3. Review diff and one-step revert make real edits less scary
4. Works with local `stdio` MCP clients instead of a single hosted workflow

## Directory copy

### Short

Local MCP for Microsoft Power Automate with browser-backed auth and safer flow edits.

### Medium

Local MCP server for Microsoft Power Automate with browser-backed auth, explicit target flow locking, validation, review diff, and rollback.

### Long

Operate Microsoft Power Automate flows from MCP clients using your existing logged-in browser session. This repo provides explicit target flow selection, flow reads and updates, validation, run inspection, post-save review diff, and one-step rollback without requiring Microsoft Entra app registration.

## Suggested tags

- MCP
- Power Automate
- Microsoft
- automation
- browser-backed auth
- workflow automation
- Codex
- Claude Code

## Suggested GitHub repo metadata

Repository description:

> Local MCP for Microsoft Power Automate with browser-backed auth, explicit target locking, safer flow edits, review diff, and rollback.

Suggested topics:

- `mcp`
- `model-context-protocol`
- `power-automate`
- `power-platform`
- `workflow-automation`
- `browser-extension`
- `codex`
- `claude-code`
- `ai-agents`

## GitHub release notes template

Title:

`v0.4.0 — safer Power Automate operations with a clearer workspace`

Body:

```md
## What changed

- refined the extension popup into a compact quick launcher
- reorganized the side panel into Today, Flows, Review, and System
- moved the saved-change diff into a dedicated review workspace
- tightened the UI for faster daily use
- synced docs and skill guidance with the new workspace flow

## Why this matters

This repo is for MCP users who want to do real Power Automate work without getting blocked by enterprise auth setup, wrong-tab edits, or blind saves.

## Install

### MCP

codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate

### Skill

npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

## Launch post — long form

```text
I shipped MCP Power Automate: a local MCP server + browser extension + Codex skill for working with Microsoft Power Automate flows through your existing logged-in browser session.

The main thing I wanted to remove was setup pain.

You do not need to provision a Microsoft Entra app registration just to get started.
You can explicitly lock the MCP onto a target flow instead of blindly following whatever tab is active.
And after a save, the extension can show a structured review diff and keep one-step rollback history.

What it can do today:
- list flows in the current environment
- set an explicit active target flow
- read / validate / update / clone flows
- inspect runs and action-level failures
- trigger manual/request flows
- review and revert the last saved change

Repo:
https://github.com/kaael1/mcp-power-automate

Install the MCP:
codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate

Install the skill:
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

## Launch post — short

```text
Built a local MCP for Microsoft Power Automate.

- browser-backed auth
- explicit target flow locking
- validate/update/test flows
- saved-change review diff
- one-step rollback
- no Microsoft Entra app registration required to get started

Repo: https://github.com/kaael1/mcp-power-automate
Skill: npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
MCP: codex mcp add power-automate-local -- npx -y @kaael1/mcp-power-automate
```

## Community angles

- MCP directories:
  - emphasize protocol compatibility, install path, and real-world usefulness
- Codex / Claude Code users:
  - emphasize skill + safer flow editing
- Power Automate communities:
  - emphasize no-Entra-setup onboarding and safer AI-assisted edits

## Demo storyboard

30-second capture sequence:

1. Show a Power Automate flow open in the browser
2. Show the MCP install command
3. Show `list_flows` and `select_flow`
4. Show a small flow update
5. Show the extension `Review` workspace with the diff
6. Show the revert path

The demo should make three things visually obvious:

- no custom enterprise auth setup
- explicit target control
- safer change review than a blind save
