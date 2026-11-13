import express from 'express';
import { createRemoteJWKSet } from 'jose';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { OdooClient, WorkError } from './odoo.js';
import { WorkService } from './service.js';
import { DemoService } from './demo.js';
import { createMcp, listShape, prepareShape } from './mcp.js';
import { jwtAuthenticator } from './auth.js';

export function createApp({ service, store, authenticate, publicUrl, demo = false, oidc = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); next(); });
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', mode: demo ? 'demo' : 'authenticated', version: '0.2.0' }));
  app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({ resource: `${publicUrl}/mcp`, authorization_servers: [oidc.issuer], scopes_supported: ['odoo:read', 'odoo:write'] }));
  app.get('/setup/config', (_req, res) => res.json({ demo, clientId: oidc.clientId, authorizationEndpoint: oidc.authorizationEndpoint, tokenEndpoint: oidc.tokenEndpoint, scopes: oidc.scopes || 'openid odoo:read odoo:write', resource: `${publicUrl}/mcp`, redirectUri: `${publicUrl}/setup/callback` }));
  const file = name => fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
  app.get(['/setup', '/setup/callback'], (_req, res) => res.sendFile(file('setup.html')));
  app.get('/dashboard', (_req, res) => res.sendFile(file('dashboard.html')));
  app.use(['/api', '/mcp'], async (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ![publicUrl, 'https://chatgpt.com', 'https://chat.openai.com'].includes(origin)) return res.status(403).json({ error: { code: 'ORIGIN', message: 'Origin is not allowed.' } });
    try {
      const identity = await authenticate(req);
      if (!identity?.sub || !identity?.iss) throw new Error('Missing identity.');
      req.subject = store ? store.subject(identity) : 'demo';
      req.canWrite = identity.scopes.includes('odoo:write');
      if (!identity.scopes.includes('odoo:read')) return res.status(403).json({ error: { code: 'SCOPE', message: 'odoo:read scope is required.' } });
      next();
    } catch {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource", scope="odoo:read"`);
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in through the secure setup page.' } });
    }
  });
  const endpoint = (schema, handler, write = false) => async (req, res, next) => {
    try {
      if (write && !req.canWrite) throw new WorkError('SCOPE', 'odoo:write scope is required.');
      const input = schema.parse(req.body || {});
      res.json(await handler(req, input));
    } catch (error) { next(error); }
  };
  const company = { company_id: z.number().int().positive().optional() };
  app.post('/api/discover', endpoint(z.object({ ...company, include_modules: z.boolean().default(false) }), (req, args) => service.invoke(req.subject, 'describe', args)));
  app.post('/api/people', endpoint(z.object({ ...company, search: z.string().max(200).default(''), limit: z.number().int().min(1).max(100).default(50) }), (req, args) => service.invoke(req.subject, 'people', args)));
  app.post('/api/list', endpoint(z.object(listShape), (req, args) => service.invoke(req.subject, 'list', args)));
  app.post('/api/prepare', endpoint(z.object(prepareShape), (req, args) => service.invoke(req.subject, 'prepare', args), true));
  app.post('/api/execute', endpoint(z.object({ ...company, operation_id: z.string().min(20).max(100), confirmed: z.literal(true) }), (req, args) => service.invoke(req.subject, 'execute', args), true));
  app.post('/api/result', endpoint(z.object({ ...company, operation_id: z.string().min(20).max(100) }), (req, args) => service.invoke(req.subject, 'result', args)));
  app.post('/api/connection', endpoint(z.object({ baseUrl: z.string().max(2000), database: z.string().max(100).regex(/^[\w.-]*$/).default(''), apiKey: z.string().min(10).max(1024), transport: z.enum(['json2', 'adapter']).default('json2') }), (req, args) => {
    if (demo) throw new WorkError('DEMO', 'Demo mode cannot store real credentials.');
    return service.connect(req.subject, args);
  }, true));
  app.delete('/api/connection', (req, res) => { if (!demo) service.disconnect(req.subject); res.json({ disconnected: true, note: 'Revoke the Odoo API key in Odoo as well. Backup retention is controlled by your administrator.' }); });
  app.post('/mcp', async (req, res, next) => {
    const server = createMcp(service, req.subject, req.canWrite, publicUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); } catch (error) { if (!res.headersSent) next(error); }
  });
  app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());
  app.use((error, _req, res, _next) => {
    const validation = error instanceof z.ZodError || error.type === 'entity.parse.failed';
    res.status(validation ? 400 : error.code === 'SCOPE' ? 403 : 422).json({ error: { code: validation ? 'INVALID_INPUT' : error.code || 'OPERATION_FAILED', message: validation ? 'The request contains invalid or missing fields.' : error.code ? error.message : 'The operation failed. Check the server configuration.' } });
  });
  return app;
}

export async function start() {
  const demo = process.env.DEMO_MODE === '1';
  const port = Number(process.env.PORT || 8787);
  const publicUrl = (process.env.PUBLIC_URL || (demo ? `http://127.0.0.1:${port}` : '')).replace(/\/$/, '');
  if (!demo && (!publicUrl.startsWith('https://') || !process.env.OIDC_ISSUER?.startsWith('https://') || !process.env.OIDC_JWKS_URL?.startsWith('https://') || !process.env.OIDC_AUDIENCE || process.env.OIDC_AUDIENCE !== `${publicUrl}/mcp`)) throw new Error('Configure HTTPS PUBLIC_URL, OIDC_ISSUER, OIDC_JWKS_URL and OIDC_AUDIENCE=PUBLIC_URL/mcp before starting.');
  const oidc = { issuer: process.env.OIDC_ISSUER, clientId: process.env.OIDC_CLIENT_ID, authorizationEndpoint: process.env.OIDC_AUTHORIZATION_ENDPOINT, tokenEndpoint: process.env.OIDC_TOKEN_ENDPOINT, scopes: process.env.OIDC_SCOPES };
  const store = demo ? null : new Store(process.env.DATA_DIR || './data', process.env.ENCRYPTION_KEY);
  const client = demo ? null : new OdooClient();
  const service = demo ? new DemoService() : new WorkService(store, client);
  const jwks = demo ? null : createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URL));
  const authenticate = demo ? async () => ({ iss: 'demo', sub: 'demo', scopes: ['odoo:read', 'odoo:write'] }) : jwtAuthenticator({ issuer: oidc.issuer, audience: process.env.OIDC_AUDIENCE, jwks });
  const app = createApp({ service, store, authenticate, publicUrl, demo, oidc });
  const http = app.listen(port, '127.0.0.1', () => console.log(`Odoo Work ${demo ? 'DEMO' : 'authenticated server'}: ${publicUrl}/setup`));
  const stop = () => http.close(async () => { store?.close(); await client?.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return http;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start().catch(() => { console.error('Startup failed. Check .env configuration and installed dependencies.'); process.exitCode = 1; });
