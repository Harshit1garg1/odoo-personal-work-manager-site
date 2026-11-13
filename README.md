# Odoo Personal Work Manager

**A personal productivity assistant for people who manage their work in Odoo.**

Odoo Personal Work Manager is an independent project by [Harshit Garg](https://github.com/Harshit1garg1). It is intended to help individuals understand their project workload, review time spent, plan realistic allocations, and keep task progress organized with the help of ChatGPT.

> **Current release status:** The ChatGPT plugin currently provides workflow guidance only. It does not yet connect to an Odoo server, retrieve live records, or make changes in an Odoo database. Live Odoo integration is planned for a future release.

## What the project is designed to help with

- **Project and task overview:** Summarize assigned work, pending tasks, deadlines, priorities, and project progress.
- **Time-spent analysis:** Review timesheet entries and compare actual logged time with planned effort without confusing estimates, scheduled hours, and actual time.
- **Workload planning:** Prepare realistic weekly or date-range allocations, identify capacity problems, and suggest possible rebalancing.
- **Task completion workflow:** Check the relevant task and its configured completion stage. Any consequential status change should be confirmed by the user and verified after the update.

These are the intended workflows. Availability of live data and write operations depends on the future connector and the permissions of the connected Odoo account.

## Odoo integration plans

The planned integration will ask each user for their own Odoo instance URL and securely configured API credentials. For compatible Odoo 19 deployments, the preferred integration approach is Odoo's External JSON-2 API.

The connector is not part of the current release. Before using live integration, the project must implement and verify secure credential capture and storage, per-user isolation, HTTPS validation, access-control enforcement, safe read/write operations, and credential revocation. Odoo version, deployment type, subscription, and API availability must be checked for each instance.

**Never post an Odoo API key, password, session cookie, database backup, or confidential Odoo data in a public issue or repository.** API credentials must not be shared in ordinary ChatGPT messages.

## Privacy and terms

The current release does not include a developer-operated Odoo connector or credential store. Information users choose to submit to ChatGPT is handled under the applicable OpenAI policies and account or workspace settings. The informational website is hosted by GitHub Pages.

Read the full project policies:

- [Privacy Policy](https://harshit1garg1.github.io/odoo-personal-work-manager-site/privacy.html)
- [Terms of Service](https://harshit1garg1.github.io/odoo-personal-work-manager-site/terms.html)
- [Support](https://harshit1garg1.github.io/odoo-personal-work-manager-site/support.html)
- [Project website](https://harshit1garg1.github.io/odoo-personal-work-manager-site/)

These pages describe the current workflow-only release. They must be updated before a future connector is enabled so that its actual data handling, hosting, retention, deletion, and security arrangements are accurately disclosed.

## Pricing

The current release is free and does not offer paid features or in-plugin purchases. Optional paid functionality may be considered in a future version. Any future paid offering will be described with its applicable pricing and terms before it is made available.

## Support and feedback

For questions, bug reports, and feature suggestions, please [open an issue](https://github.com/Harshit1garg1/odoo-personal-work-manager-site/issues). Include reproducible steps and anonymized examples where possible. Do not include secrets, customer information, employee information, or confidential business records in public issues.

## Developer

Created and maintained by [Harshit Garg](https://github.com/Harshit1garg1).

## Independence and trademarks

Odoo Personal Work Manager is an independent project. It is not an official Odoo product and is not affiliated with or endorsed by Odoo S.A. “Odoo” is used only to identify the software this project is designed to assist with. Odoo is a trademark of its respective owner. ChatGPT and OpenAI are trademarks of their respective owner.
