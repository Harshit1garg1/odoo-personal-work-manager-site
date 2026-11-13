# Odoo Work Manager — 0.2.0

An authenticated MCP connector, ChatGPT dashboard, workflow skill and Odoo 19 addon for projects, tasks, assignments, allocations, timesheets, private todos and notes. This replaces the skills-only prototype. Live access needs deployment configuration and an installed addon; the demo runs without Odoo.

## Try the demo

Requires Node.js 24 or newer:

```powershell
npm ci
npm run demo
```

Open [the local dashboard](http://127.0.0.1:8787/dashboard). Sample data is labelled and stays in memory. Demo mode cannot store real credentials. Restart it to reset the data.

## Implemented

- Search, paging and full filtered totals for projects, tasks, timesheets, todos and notes.
- Create/edit projects and tasks, find assignees, change allocations, and complete work through verified statuses/actions.
- Log/edit timesheets with employee mapping, period totals and task/project consistency checks. Submit/approve are available when the company's supported methods are configured.
- Private fallback todo/note models, or company-specific mappings to existing modules.
- Per-company model, field, default, ownership, completion and workflow mappings; metadata discovery; unavailable capabilities reported explicitly.
- Responsive MCP Apps dashboard in ChatGPT and a standalone dashboard using the same service.
- OAuth JWT verification, PKCE setup, encrypted per-user credentials, hostname/DNS checks, scope enforcement, disconnect and audit events without keys or record bodies.
- Expiring previews, record-change detection, permission/schema rechecks, atomic writes, read-back verification and duplicate-safe receipts.

Project completion remains unknown until configured. Cancelled and successfully completed tasks remain separate. No Odoo dashboard module is required.

## Connect real Odoo

Follow [deployment](docs/deployment.md) and [custom modules](docs/custom-modules.md).

1. Install `odoo_addons/odoo_work_assistant` on Odoo 19. It depends only on `base`; Project/Timesheet features appear when installed. Hosted instances that do not allow custom addons need a separate reviewed integration; this package does not bypass that limitation.
2. Configure `.env` from `.env.example`: external OAuth provider, audience, encryption key, data directory and approved Odoo hosts.
3. Run `npm run build`, then `npm start` behind HTTPS. Node binds loopback.
4. Visit `/setup`, sign in and securely enter your own Odoo API key. Prefer JSON-2; explicitly choose the installed addon adapter if needed.
5. Run `node scripts/configure.js --url https://YOUR-CONNECTOR` to generate endpoint manifests. Connect `/mcp` in ChatGPT and install the skill.

The connector integrates with an external OAuth authorization server. It does not provision an identity provider. ChatGPT and setup must resolve the same stable issuer/subject.

## Verify

```powershell
npm run build
npm test
node tests/browser-check.js
python scripts/check-addon.py
```

Browser checks use installed Edge/Chrome or Playwright Chromium. Install it with `npx playwright install chromium` if needed. The Python checker verifies syntax/XML/ACL references, not live behavior.

Run the included Odoo transactional tests on a clean database when Docker is available:

```sh
docker compose -f compose.odoo-test.yml up --abort-on-container-exit --exit-code-from odoo
```

See [validation](docs/validation.md) for checks actually run for this delivery.

## Boundaries

Supported target: Odoo 19. Other versions need compatibility testing. Unknown custom business meaning requires administrator configuration. Wizard workflows require a reviewed adapter or Odoo UI. Normal Odoo automation/notifications are disclosed before saving; external custom side effects may not roll back with the database.

The SQLite store supports one connector instance with a durable local volume. Scaling needs a shared transactional store and managed key lifecycle. Disconnect deletes active credentials; revoke the key in Odoo too. Backups and operation/audit retention remain administrator responsibilities.

References: [OpenAI MCP](https://developers.openai.com/plugins/build/mcp-server), [UI](https://developers.openai.com/plugins/build/chatgpt-ui), [OAuth](https://developers.openai.com/plugins/build/auth), [packaging](https://developers.openai.com/plugins/build/plugins), [Odoo JSON-2](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).

## Distribution

This source lives in the [website repository](https://github.com/Harshit1garg1/odoo-personal-work-manager-site). The repo marketplace is separate from the universal public directory. Read [publishing](docs/publishing.md) before submitting the connector release.
