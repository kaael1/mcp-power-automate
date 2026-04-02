# power-automate-mcp skill

Codex-focused operating guidance for the local Power Automate MCP in this repository.

This skill is for people who want Codex to inspect, validate, update, test, review, and revert Microsoft Power Automate flows through the local `power-automate-local` MCP server.

## Install

Install directly from GitHub:

```bash
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

## What it helps with

- choosing an explicit target flow instead of guessing from the active tab
- using `get_status`, `list_flows`, and `set_active_flow` safely before writes
- validating before and after saves when possible
- reviewing the last saved change and reverting it if needed
- testing manual/request flows with callback URLs and run inspection

## Why it lives in this repo

- the MCP and the skill evolve together
- the skill documents the exact tools and safety workflow this MCP exposes
- GitHub users can clone one repo and get both the server and the usage instructions
- Codex users can install it with one command instead of wiring a local path manually

The MCP server itself is still useful from any MCP client that can launch a local `stdio` server.
