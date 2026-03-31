# power-automate-mcp skill

This skill belongs in the same repository as the MCP server.

Why:

- the MCP and the skill evolve together
- the skill documents the exact tools this MCP exposes
- GitHub users can clone one repo and get both the server and the usage instructions
- local Codex config can point directly at this `SKILL.md`

Recommended local setup:

1. Register the MCP server in Codex.
2. Register the skill path in `~/.codex/config.toml`.
3. Restart Codex.

If you publish this repo, other users can do the same by pointing their Codex config at:

```text
<repo>/skills/power-automate-mcp/SKILL.md
```
