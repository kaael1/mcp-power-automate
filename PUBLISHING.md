# Publishing

This repo should publish one MCP runtime and one canonical skill bundle across multiple public surfaces.

Current surfaces:

- npm package for direct MCP installs
- Official MCP Registry via npm + `server.json`
- GitHub-backed skill installs such as `npx skills add`
- provider marketplaces such as LobeHub that can list the MCP, the skill bundle, or both

See `docs/multi-provider-distribution.md` for the architectural rule: one repo, one MCP package, one canonical skill bundle, thin provider adapters.

## 1. Verify the package locally

```powershell
bun run check
npm pack --dry-run
```

## 2. Publish to npm

Log in to npm on the machine used for release:

```powershell
npm login
```

Then publish the package:

```powershell
npm publish
```

If npm publish is protected by 2FA for writes, publish with the current one-time code:

```powershell
npm publish --access public --otp 123456
```

Expected package:

- `@kaael1/mcp-power-automate`

Expected reusable skill bundle:

- `skills/power-automate-mcp`

## 3. Publish to the Official MCP Registry

Install the official `mcp-publisher` CLI from the registry releases:

```powershell
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/download/v1.5.0/mcp-publisher_windows_$arch.tar.gz" -OutFile "mcp-publisher.tar.gz"
tar xf mcp-publisher.tar.gz
Remove-Item mcp-publisher.tar.gz
```

Authenticate with GitHub:

```powershell
.\mcp-publisher.exe login github
```

Or authenticate with a GitHub PAT:

```powershell
.\mcp-publisher.exe login github -token YOUR_GITHUB_PAT
```

Then publish from the repository root:

```powershell
.\mcp-publisher.exe publish
```

This uses:

- `package.json#mcpName`
- `server.json`

## 4. Refresh skill surfaces

Keep the skill provider-neutral and publish the same folder everywhere possible:

- canonical folder: `skills/power-automate-mcp`
- canonical skill file: `skills/power-automate-mcp/SKILL.md`

GitHub-backed install path:

```powershell
npx skills add kaael1/mcp-power-automate --skill power-automate-mcp
```

If a provider supports `SKILL.md` bundles directly, prefer submitting this same folder instead of maintaining a forked copy.

## 5. Refresh provider marketplaces

For LobeHub and similar directories, think in two listings:

1. MCP listing
   Use the npm package, GitHub repo, and `server.json` metadata.
2. Skill listing
   Use `skills/power-automate-mcp` as the canonical bundle.

Position the MCP as local or local-first because it depends on:

- a local Chromium extension
- a logged-in browser session
- a local bridge and local MCP process

## 6. Verify

Check npm:

```powershell
npm view @kaael1/mcp-power-automate version
```

Check the public repo:

- https://github.com/kaael1/mcp-power-automate

Check the Official MCP Registry listing:

- https://registry.modelcontextprotocol.io/v0/servers?search=io.github.kaael1/mcp-power-automate

Check skills discovery:

```powershell
npx skills add kaael1/mcp-power-automate --list
```

Notes:

- If the npm release is newer than the Official MCP Registry listing, re-run the registry publish step so public metadata stays aligned.
- skills.sh discoverability is influenced by install telemetry, so the direct `npx skills add kaael1/mcp-power-automate --skill power-automate-mcp` path matters for early momentum.
- The newer `mcp-publisher` CLI accepts `publish --dry-run`, which is useful for validating `server.json` before pushing a live registry update.
- When adding a new provider, prefer adding a thin adapter doc or marketplace entry rather than forking `skills/power-automate-mcp/SKILL.md`.
