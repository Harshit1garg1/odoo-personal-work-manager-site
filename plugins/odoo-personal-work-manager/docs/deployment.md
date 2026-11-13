# Deployment

## Odoo

Copy `odoo_addons/odoo_work_assistant` into the Odoo 19 addons path. Restart Odoo, update Apps and install **Odoo Work Assistant**. It depends only on `base`; work features are discovered when their modules exist.

```sh
odoo --addons-path=/opt/odoo/addons,/opt/work/odoo_addons -d staging -i odoo_work_assistant --stop-after-init
```

Use staging first. The addon creates company profiles, private todos/notes and operation previews/receipts. It does not globally replace Odoo workflows. Standard task completion uses verified task status rather than the Kanban column. Project completion needs its own mapping.

## OAuth provider

Configure an external OAuth 2.1 provider with PKCE S256, HTTPS discovery/JWKS, and RS256/ES256 JWT access tokens. Use resource/audience `https://YOUR-CONNECTOR/mcp` and scopes `odoo:read`, `odoo:write`. Only grant write scope to authorized people.

Register a public setup client with callback `https://YOUR-CONNECTOR/setup/callback`, token authentication `none` and CORS for your connector origin at the token endpoint. Register ChatGPT's actual callback URI from its connection setup as a separate client, or configure supported dynamic registration. Both clients must receive the SAME stable subject for the same person.

Token lifetimes, users, refresh/revocation and login policy belong to the identity provider. The setup page stores no refresh token; sign in again after expiry. The connector verifies issuer/audience/signature/subject/expiry and publishes protected-resource metadata and a 401 discovery challenge. It is the resource server, not an identity provider.

## Server

```sh
npm ci
npm run build
cp .env.example .env
# Configure .env before starting:
npm start
```

Configure a persistent local `DATA_DIR` and a separately protected random 32-byte `ENCRYPTION_KEY`. Losing the key loses access to stored credentials. Changing it without migrating ciphertext also loses access: disconnect/reconnect into a fresh store or implement reviewed re-encryption.

Proxy HTTPS to `127.0.0.1:8787`. Set proxy request limits/timeouts and rate limits. Disable body/Authorization logging. Protect the store and encrypted backups with OS permissions. Use a single connector process with local durable SQLite storage; do not share its files across replicas or network disks. Never expose demo mode publicly.

`ODOO_ALLOWED_HOSTS` contains exact approved hostnames. Public hosts resolving to private, loopback, link-local or reserved addresses are blocked at socket lookup, and redirects are disabled. For legitimate private Odoo, also approve its exact name in `ODOO_PRIVATE_HOSTS` and run inside the authorized network. This network decision is administrator-owned, never model input.

The JSON-2 transport is preferred and subject to the deployment's API availability/policy. The explicit addon adapter requires an actual bearer API key header even when an Odoo session cookie exists. Both methods require the addon. Odoo versions before 19 require a tested port. Hosted plans that prohibit addon installation cannot use this implementation unchanged.

## Activate

1. Open HTTPS `/setup`, sign in, and enter the approved base URL, database if needed, and your OWN Odoo user's API key.
2. The server verifies addon protocol and Odoo identity before encrypting/storing the connection. Open `/dashboard` to inspect discovered capabilities.
3. Configure custom mappings in Odoo using [the mapping guide](custom-modules.md).
4. Generate endpoint manifests: `node scripts/configure.js --url https://YOUR-CONNECTOR`. Optionally add `--client-id YOUR-CHATGPT-PUBLIC-CLIENT`.
5. Register/connect `/mcp` in ChatGPT with the OAuth provider and install the skill. Test reads, then one staging write. Refresh the connection after tool changes.

The unconfigured source package contains no fabricated endpoint. Run the configuration command after choosing your real URL.

## Credentials and retention

Own-user keys preserve identity. A bot acts as the bot, not a human impersonator. Company context and record rules are checked on every operation. Model-level permissions do not guarantee access to every record.

Credentials use AES-256-GCM with hashed OAuth issuer/subject as authenticated metadata. Reconnection replaces the stored key deliberately; a silently changed Odoo identity is rejected. Disconnect deletes the active ciphertext and checkpoints the log; revoke the key in Odoo too. Backup retention is your administrative policy.

Audit events contain time, hashed subject, operation and outcome, without keys or record bodies. Odoo receipts contain previews/results and therefore private work data. Owner/company rules restrict them. Define receipt and backup retention; do not purge receipts while callers might retry. A missing receipt must never be treated as evidence that a create failed.

Custom external automation may not be reversible by a database rollback. Map only reviewed business actions with sound transaction behavior. Re-test after customer module upgrades; mapping/schema changes invalidate outstanding previews.
