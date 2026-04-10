# power-automate-mcp skill

Portable operating guidance for the local Power Automate MCP in this repository.

This skill bundle is for people who want an agent to inspect, validate, update, test, review, and revert Microsoft Power Automate flows through the local MCP server in this repository.

The goal is to keep one canonical `SKILL.md` bundle that can be reused across Codex, LobeHub, and other skill-capable agent platforms.

## Install

Install directly from GitHub with `skills.sh`-style tooling:

```bash
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

Other valid distribution paths:

- submit the same folder to a skill marketplace such as LobeHub
- install it locally into a provider-specific skills directory
- keep using the MCP without the skill when the client only supports MCP, not skills

## What it helps with

- choosing an explicit target flow instead of guessing from the active tab
- using `get_context`, `list_flows`, and `select_flow` safely before writes
- validating before and after saves when possible
- previewing a change before saving it
- reviewing the last saved change and reverting it if needed
- testing manual/request flows with callback URLs and run inspection

## Why it lives in this repo

- the MCP and the skill evolve together
- the skill documents the exact tools and safety workflow this MCP exposes
- GitHub users can clone one repo and get both the server and the usage instructions
- maintainers can publish one canonical skill bundle to multiple providers instead of forking the instructions

The MCP server itself is still useful from any MCP client that can launch a local `stdio` server.
Provider notes live in [references/providers.md](references/providers.md).
