# Discovery Audit — 2026-04-02

This file captures the observed public discovery status of `kaael1/mcp-power-automate` during the first growth push.

## Current public surfaces

- GitHub
  - Repo is public: `kaael1/mcp-power-automate`
  - Public repo page currently shows very early social proof: low star count, no open issues, and no open PRs
  - README is the main conversion surface today
- npm
  - Package exists at `@kaael1/mcp-power-automate`
  - Public npm latest was still `0.3.0` during this audit
  - This creates a mismatch when the repo has newer docs or release messaging
- Official MCP Registry
  - Listing exists for `io.github.kaael1/mcp-power-automate`
  - Registry was still showing `0.2.0` during this audit
  - This is a major trust and discoverability mismatch
- skills.sh
  - Direct install path works:
    - `npx skills add kaael1/mcp-power-automate --list`
  - Search discoverability was weak during this audit:
    - no result for `kaael1`
    - no result for `mcp-power-automate`
    - no result for `power-automate-mcp`
  - This suggests the skill is installable but not yet gaining enough install/search momentum to surface
- PulseMCP
  - Search results suggest the server has already been indexed there
  - This is a positive signal that third-party MCP directories can pick up the project from public metadata

## Main discoverability problems

1. Version mismatch across repo, npm, and Official MCP Registry
2. Very low social proof on GitHub
3. skills.sh compatibility exists, but searchable discovery does not
4. README positioning was previously accurate but not optimized for conversion

## Immediate priorities

1. Keep GitHub `main`, npm latest, and Official MCP Registry on the same version
2. Drive installs through the official `skills` CLI path to build skills.sh telemetry
3. Make README instantly answer:
   - what it is
   - why it matters
   - how to install it
   - why it is safer than naive browser automation
4. Publish a clear launch message aimed at MCP power users, not generic automation users

## High-leverage channels

- GitHub repo and release notes
- npm package page
- Official MCP Registry listing
- skills.sh install path and future search visibility
- Third-party MCP directories that crawl public metadata

## What success looks like next

- npm latest and Official MCP Registry both show the same current version
- direct GitHub-to-skill installs start happening consistently
- searches for `Power Automate MCP` and related phrases start returning owned surfaces worth clicking
- repo social proof begins to move through stars, watchers, and external mentions
