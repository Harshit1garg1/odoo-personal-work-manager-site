# Public directory publishing

## Status

This repository contains v0.2.0 source, not a live public Odoo service. The MCP configuration is intentionally empty. The existing ChatGPT listing's access and deployed version are unverified. A repo marketplace exposes the bundled workflow skill to supported local clients, but does not add live Odoo tools until the connector is configured. No public-directory submission is claimed.

## Before submission

1. Deploy the connector behind a stable public HTTPS hostname with the OAuth provider, approved Odoo hostnames and durable encrypted storage described in [deployment.md](deployment.md). Install the addon and company mappings in a clean Odoo 19 staging environment.
2. Run the build and automated tests, then validate actual Odoo reads, a confirmed write, access denial, custom mappings and connection removal. Local sample tests alone do not establish live behavior.
3. From the plugin folder, run `node scripts/configure.js --url https://YOUR-REAL-CONNECTOR` (and `--client-id` if required). This updates `mcp.json` and `.mcp.json` without writing secrets. Do not submit an empty MCP configuration as though it offers live tools.
4. Verify the website, support, privacy and terms URLs and manifest icons. Choose a source distribution license before promising reuse rights.
5. Record a walkthrough of real staging workflows and create a least-privilege reviewer account with fictional records. Reviewer passwords and API keys go only into the private review form, never the package or repository.
6. Prepare at least five positive and three negative review cases. Suggested positives: list assigned tasks; show a period's timesheets; preview and confirm a time entry; confirm configured task completion; create a private todo. Suggested negatives: denied company access; missing custom workflow mapping; unconfirmed write. Record actual expected results and actual tool names after validation; these suggestions are not test evidence.
7. Create a plugin ZIP from this folder after configuration. Include the root `plugin.json`, `mcp.json`, skills, icons and all intended components. Exclude `.env`, credentials, data, backups, node_modules, local scratch files and reviewer secrets.

## Submission and release

Use a verified developer identity with the required organization role in [OpenAI Platform Plugins](https://platform.openai.com/plugins). Upload the configured ZIP, complete domain verification and OAuth setup, resolve automated findings, provide review materials, then submit for review. Publish the approved version when ready. Account access, developer verification, policy attestations and approval are still required.

An existing skills-only plugin cannot currently gain an MCP server through an update. If the linked listing is skills-only, use a new MCP-capable submission and replace the website listing URL after the new one is available. Do not assume the old listing ID will represent the connector release.

Sources checked 13 November 2026: [Upload and submit](https://developers.openai.com/plugins/deploy/submission), [Package and repo marketplace](https://developers.openai.com/plugins/build/plugins).
