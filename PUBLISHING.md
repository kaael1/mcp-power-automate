# Publishing

This repo supports two distribution paths today:

- `skills.sh` / Vercel-style skill install from GitHub
- Official MCP Registry via npm + `server.json`

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

## 4. Verify

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
