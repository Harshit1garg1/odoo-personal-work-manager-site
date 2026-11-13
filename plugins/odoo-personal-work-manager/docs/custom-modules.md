# Custom modules and workflows

An Odoo administrator opens **Work Assistant → Company Mappings** and adds one profile for each company needing overrides. Ordinary users can read their company's profile but cannot change it.

JSON keys are `project`, `task`, `timesheet`, `todo`, `note`. A concept override replaces its entire default mapping. Set a concept to `false` to disable it. The example below uses illustrative custom fields: verify the actual schema before using it.

```json
{
  "task": {
    "model": "x_delivery.work_item",
    "fields": {
      "name": "name", "description": "x_description", "project": "x_project_id",
      "assignees": "x_user_ids", "deadline": "x_due_date", "status": "x_state",
      "service_code": "x_service_code", "company": "company_id"
    },
    "editable": ["name", "description", "project", "assignees", "deadline", "service_code"],
    "defaults": {"service_code": "INTERNAL"},
    "owner": {"field": "assignees", "identity": "user"},
    "completion": {"field": "status", "done": ["delivered"], "cancelled": ["cancelled"]},
    "actions": {
      "complete": {
        "method": "action_confirm_delivery",
        "verify": {"status": "delivered"},
        "side_effects": "Runs validation and may notify project followers."
      }
    }
  }
}
```

`fields` maps logical tool/UI names to actual fields. Every concept needs `name`. `editable` is the writable allowlist; `defaults` use logical names. `owner` selects the caller's Odoo user or uniquely mapped company employee (`identity: employee`). A `domain` list can add an administrator-controlled Odoo domain.

Projects without an owner mapping derive personal scope through the configured task project's relation. If this cannot be resolved, personal project scope fails explicitly rather than broadening access.

## Timesheets

To add custom required values, override the full timesheet mapping, including name/date/employee/project/task/hours/company, then add custom logical fields to `fields` and `editable` or `defaults`. A conventional starting point is shown below; replace example approval names with methods and values verified in your module.

```json
{
  "timesheet": {
    "model": "account.analytic.line",
    "fields": {"name":"name","date":"date","employee":"employee_id","project":"project_id","task":"task_id","hours":"unit_amount","company":"company_id","approval_status":"x_approval_state"},
    "editable": ["name","date","project","task","hours"],
    "owner": {"field":"employee","identity":"employee"},
    "domain": [["project_id","!=",false]],
    "actions": {
      "submit": {"method":"action_submit_for_review","verify":{"approval_status":"submitted"},"side_effects":"Sends the entry to its reviewer."},
      "approve": {"method":"action_manager_approve","verify":{"approval_status":"approved"},"side_effects":"Approves under the caller's Odoo permissions."}
    }
  }
}
```

Business modules must enforce approval roles, locked periods and constraints in ORM methods. Hidden buttons and UI-only readonly states are not authorization. The connector never adds sudo or a bypass.

## Custom action contract

A configured method must start with `action_`, operate on the selected record, check its own business permissions and finish without a wizard. Supply a nonempty `verify` mapping of logical fields to expected final values. Do not commit midway or emit irreversible external events before verification; use a transactional outbox if needed. Wizard-returning actions roll back and direct the user to Odoo.

Mappings and field metadata are checked again before execution. Changes invalidate old previews. Custom models can replace standard concepts entirely. Unknown actions are unavailable until configured; schema inspection alone cannot explain arbitrary business meaning.

The included `odoo.work.todo` and `odoo.work.note` models are owner/company-private fallbacks. Map existing apps if preferred; never assume that a note is public chatter or a todo is always a project task. Review each profile on a staging database using the intended user's actual permissions.
