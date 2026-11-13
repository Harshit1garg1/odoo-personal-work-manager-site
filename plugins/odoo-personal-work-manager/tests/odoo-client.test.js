import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OdooClient, publicAddress, validateHost } from '../server/odoo.js';

test('host validation blocks unapproved hosts, credentials, paths, ports and insecure URLs', () => {
  const allowed = ['work.example.com'];
  assert.equal(validateHost('https://work.example.com/', allowed), 'https://work.example.com');
  for (const url of ['http://work.example.com', 'https://evil.example.com', 'https://work.example.com@evil.example.com', 'https://a:b@work.example.com', 'https://work.example.com/x', 'https://work.example.com:444', 'https://work.example.com/?key=x', 'https://work.example.com/#x']) assert.throws(() => validateHost(url, allowed));
  assert.throws(() => validateHost('https://127.0.0.1', ['127.0.0.1']));
  assert.throws(() => validateHost('https://[::1]', ['[::1]']));
});
test('SSRF address checks cover IPv4, IPv6 and IPv4-mapped IPv6', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1', 'bad']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true, address);
});
test('JSON2 and adapter calls use controlled endpoints and never redirect', async () => {
  const calls = [];
  const client = new OdooClient({ allowedHosts: ['work.example.com'], fetchImpl: async (url, args) => { calls.push({ url, args }); return new Response(JSON.stringify({ protocol: 1 })); } });
  const connection = { baseUrl: 'https://work.example.com', apiKey: 'secret', database: 'company' };
  try {
    await client.call(connection, 'context');
    await client.call({ ...connection, transport: 'adapter' }, 'list', { concept: 'task' });
    assert.equal(calls[0].url, 'https://work.example.com/json/2/odoo.work.service/work_context');
    assert.equal(calls[1].url, 'https://work.example.com/odoo-work/v1/list');
    assert.equal(calls[0].args.redirect, 'error');
    assert.equal(calls[0].args.headers['X-Odoo-Database'], 'company');
    await assert.rejects(client.call(connection, 'unlink'), /Unsupported/);
  } finally { await client.close(); }
});
test('business validation is preserved without returning an Odoo traceback', async () => {
  const client = new OdooClient({ allowedHosts: ['work.example.com'], fetchImpl: async () => new Response(JSON.stringify({ name: 'odoo.exceptions.UserError', message: 'The record changed after preview.', debug: 'SECRET STACK TRACE' }), { status: 400 }) });
  try { await assert.rejects(client.call({ baseUrl: 'https://work.example.com', apiKey: 'secret' }, 'execute'), error => error.message === 'The record changed after preview.' && !error.message.includes('SECRET')); } finally { await client.close(); }
});
test('invalid responses and network failures do not leak connection secrets', async () => {
  const connection = { baseUrl: 'https://work.example.com', apiKey: 'NEVER_ECHO_ME' };
  for (const fetchImpl of [async () => { throw new Error('NEVER_ECHO_ME'); }, async () => new Response('not json')]) {
    const client = new OdooClient({ allowedHosts: ['work.example.com'], fetchImpl });
    try { await assert.rejects(client.call(connection, 'context'), error => !error.message.includes('NEVER_ECHO_ME')); } finally { await client.close(); }
  }
});
