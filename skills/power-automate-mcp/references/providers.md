# Provider Notes

This repository is meant to support multiple agent providers without forking the operating guidance.

## Canonical layers

1. Runtime layer: the MCP server package `@kaael1/mcp-power-automate` plus the local Chromium extension.
2. Skill layer: this folder, with `SKILL.md` as the canonical agent guidance.
3. Provider layer: marketplace listings, install commands, or thin metadata wrappers for a specific platform.

## Portability rules

1. Keep the flow-operating guidance in `../SKILL.md`.
2. Keep provider-specific installation or marketplace notes outside the core workflow whenever possible.
3. Do not fork the skill just to rename a client or marketplace.
4. Preserve the canonical MCP tool names and safety workflow across providers.
5. If a provider needs extra metadata, treat it as a thin adapter around this folder instead of a new source of truth.

## Known provider surfaces

- Codex: can use the MCP directly and can consume a local or repo-backed `SKILL.md` bundle.
- LobeHub: can surface the MCP in the MCP marketplace and the same skill bundle in the Skills marketplace.
- Claude Code, Cursor, and similar agent IDEs: can reuse the same MCP runtime and the same `SKILL.md` bundle when they support skills.
- Generic MCP clients without a skill system: can still use the MCP package directly; the skill remains useful as maintainership and human guidance.

## Naming guidance

- npm package: `@kaael1/mcp-power-automate`
- MCP registry name: `io.github.kaael1/mcp-power-automate`
- Example local server label: `power-automate-local`

The local server label may vary by client configuration. Keep the npm package, registry identity, and core tool names stable even if the user-facing label changes.
