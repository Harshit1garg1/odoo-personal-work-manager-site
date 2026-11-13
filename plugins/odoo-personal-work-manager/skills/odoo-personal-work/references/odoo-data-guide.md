# Data and tool guide

The package includes a remote MCP server and an Odoo 19 addon. Both are required for live operation. All business operations run as the authenticated Odoo user through its ORM permissions and record rules.

| Tool | Purpose |
|---|---|
| `discover_odoo` | Identity, companies, timezone, capabilities, metadata, mappings, optional modules |
| `show_work_dashboard` | Interactive dashboard |
| `list_work` | Paged records and full filtered totals |
| `list_assignable_people` | Find permitted internal assignees |
| `prepare_work_change` | Ten-minute exact preview; no business update |
| `execute_work_change` | Apply an approved preview and save its receipt atomically |
| `get_work_change_result` | Recover a receipt after timeout |

Concepts are `project`, `task`, `timesheet`, `todo`, `note`. Use discovered logical fields and selection values; standard model names are starting points only. Unknown completion is not zero.

## Connection

The server's HTTPS `/setup` page authenticates the person using OAuth PKCE, then captures their Odoo URL/database/API key. ChatGPT receives no Odoo secret. An administrator approves exact hostnames centrally. Private hosts also need explicit private-network approval and connectivity.

Odoo 19+ JSON-2 calls use `/json/2/odoo.work.service/work_<operation>`. An explicitly selected alternative uses the included addon's bearer API at `/odoo-work/v1/<operation>`. Both invoke the same Odoo service. Older versions need a tested port; no silent legacy-RPC fallback is implemented.

Use the person's own Odoo key. A shared bot acts as the bot, not automatic human impersonation. Current employee and company scope are verified by the addon.

## Writes

Prepare records mapping/schema revisions and the current snapshot. Execute locks the operation and target record, rechecks permissions and snapshot, performs an ORM operation or administrator-mapped action, verifies saved values and stores the receipt in the same transaction. Validation failures roll the transaction back. Wizard-returning methods are rejected and rolled back.

Retry the same ID. Approval is the host/user's responsibility: a boolean does not prove a human clicked approval. The dashboard requests the click, and conversation must show the preview. Submission/approval/locking are business-module behaviors; never bypass them with a guessed status write.
