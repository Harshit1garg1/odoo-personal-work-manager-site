# Odoo Work

Odoo projects, tasks, timesheets, todos and notes, with ChatGPT as your work companion. Independent project by [Harshit Garg](https://github.com/Harshit1garg1).

[View plugin in ChatGPT](https://chatgpt.com/plugins/plugins_6af6d78b0f288191bf8bfc1bb639bc3a) · [Website](https://harshit1garg1.github.io/odoo-personal-work-manager-site/) · [Developer profile](https://github.com/Harshit1garg1)

## Repository layout

- Root HTML, CSS, JavaScript and `assets/`: GitHub Pages website, with no build step.
- [`plugins/odoo-personal-work-manager/`](plugins/odoo-personal-work-manager/): plugin manifests, workflow skills, MCP connector, dashboard, Odoo addon and tests.
- [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json): repo marketplace for supported local clients. It is separate from the public OpenAI Plugins Directory.

## Current status

The source is v0.2.0 developer preview. The existing ChatGPT listing is linked for discovery; its deployed package version and public availability have not been verified. Publishing this repository does not update that listing or make the connector live.

The connector requires an HTTPS deployment, OAuth configuration, a personal Odoo API key and the included Odoo 19 addon. Administrator-installed custom mappings support company-specific workflows. Other versions require compatibility testing. The committed MCP configurations intentionally contain no endpoint until a real deployment is configured.

## Run the sample dashboard

Requires Node.js 24 or newer:

```sh
cd plugins/odoo-personal-work-manager
npm ci
npm run demo
```

Open http://127.0.0.1:8787/dashboard. The demo uses fictional data in memory and accepts no real Odoo credentials. See the [plugin README](plugins/odoo-personal-work-manager/README.md) for build, test and deployment commands.

## Public directory publication

See [the publishing guide](plugins/odoo-personal-work-manager/docs/publishing.md) for the remaining deployment, validation and review steps. GitHub distribution and OpenAI directory approval are separate.

## Data and support

[Setup](https://harshit1garg1.github.io/odoo-personal-work-manager-site/setup.html) · [Privacy](https://harshit1garg1.github.io/odoo-personal-work-manager-site/privacy.html) · [Terms](https://harshit1garg1.github.io/odoo-personal-work-manager-site/terms.html) · [Support](https://harshit1garg1.github.io/odoo-personal-work-manager-site/support.html)

Never put credentials or confidential Odoo records in chat, public issues or Git. `.env.example` contains placeholders only. No license grant is added by this source publication; a distribution license needs the publisher's choice.

Not affiliated with or endorsed by Odoo S.A. or OpenAI.
