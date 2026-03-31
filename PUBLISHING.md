# Publishing

This repo supports two distribution paths today:

- `skills.sh` / Vercel-style skill install from GitHub
- Official MCP Registry via npm + `server.json`

## 1. Verify the package locally

```powershell
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

Authenticate with GitHub using the MCP publisher CLI:

```powershell
npx mcp-publisher login github
```

Then publish from the repository root:

```powershell
npx mcp-publisher publish
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

Check skills discovery:

```powershell
npx skills add kaael1/mcp-power-automate --list
```
