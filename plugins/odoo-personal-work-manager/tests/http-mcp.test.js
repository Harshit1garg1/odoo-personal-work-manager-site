import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/index.js';
import { DemoService } from '../server/demo.js';

async function fixture(authenticate) {
  const service = new DemoService();
  const app = createApp({ service, authenticate, publicUrl: 'http://127.0.0.1', demo: true, oidc: { issuer: 'https://id.example.com' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { service, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
const identity = scopes => async () => ({ iss: 'tests', sub: 'alice', scopes });
test('HTTP rejects missing auth, foreign origins, write-with-read-only scope and malformed input', async () => {
  const denied = await fixture(async () => { throw new Error('bad'); });
  try {
    const response = await fetch(`${denied.base}/api/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401); assert.match(response.headers.get('www-authenticate'), /resource_metadata/);
    assert.equal((await fetch(`${denied.base}/health`)).status, 200);
  } finally { await denied.close(); }
  const readonly = await fixture(identity(['odoo:read']));
  try {
    for (const [path, body, expected] of [['prepare', { concept: 'todo', action: 'create', values: { name: 'test' } }, 403], ['list', { limit: 10000 }, 400]]) {
      const response = await fetch(`${readonly.base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, expected);
    }
    assert.equal((await fetch(`${readonly.base}/api/list`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  } finally { await readonly.close(); }
});
test('official MCP client discovers tools, reads UI resource and performs a verified idempotent change', async () => {
  const fixture_ = await fixture(identity(['odoo:read', 'odoo:write']));
  const client = new Client({ name: 'integration-test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${fixture_.base}/mcp`)));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    const dashboard = tools.find(t => t.name === 'show_work_dashboard');
    assert.equal(dashboard.annotations.readOnlyHint, true);
    const resource = await client.readResource({ uri: dashboard._meta.ui.resourceUri });
    assert.match(resource.contents[0].text, /My work/);
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    const view = await client.callTool({ name: 'show_work_dashboard', arguments: { concept: 'task' } });
    assert.equal(view.structuredContent.total, 3); assert.equal(view.structuredContent.discovery.context.user.id, 7);
    const prepared = await client.callTool({ name: 'prepare_work_change', arguments: { concept: 'task', action: 'complete', record_id: 21 } });
    assert.equal(fixture_.service.records.task[0].completion, 'open');
    const args = { operation_id: prepared.structuredContent.operation_id, confirmed: true };
    const saved = await client.callTool({ name: 'execute_work_change', arguments: args });
    assert.equal(saved.structuredContent.status, 'verified'); assert.equal(saved.structuredContent.record.completion, 'done');
    const retry = await client.callTool({ name: 'execute_work_change', arguments: args });
    assert.deepEqual(retry.structuredContent, saved.structuredContent);
  } finally { await client.close(); await fixture_.close(); }
});
test('read-only MCP tools cannot execute changes', async () => {
  const fixture_ = await fixture(identity(['odoo:read']));
  const client = new Client({ name: 'readonly-test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${fixture_.base}/mcp`)));
    const result = await client.callTool({ name: 'prepare_work_change', arguments: { concept: 'todo', action: 'create', values: { name: 'Forbidden' } } });
    assert.equal(result.isError, true); assert.equal(fixture_.service.records.todo.length, 1);
  } finally { await client.close(); await fixture_.close(); }
});
