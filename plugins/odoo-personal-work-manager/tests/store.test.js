import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../server/store.js';

test('connections are encrypted, bound to identity, rotated and deleted independently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'odoo-store-'));
  const store = new Store(directory, randomBytes(32).toString('base64'));
  try {
    const a = store.subject({ iss: 'issuer', sub: 'alice' }), b = store.subject({ iss: 'issuer', sub: 'bob' });
    assert.notEqual(a, store.subject({ iss: 'other-issuer', sub: 'alice' }));
    store.put(a, { apiKey: 'private-alice-api-key', baseUrl: 'https://alice.example.com' });
    store.put(b, { apiKey: 'private-bob-api-key' });
    assert.equal(store.get(a).apiKey, 'private-alice-api-key');
    const ciphertext = store.db.prepare('SELECT secret FROM connections WHERE subject=?').get(a).secret;
    assert.throws(() => store.decrypt(b, ciphertext));
    for (const file of readdirSync(directory)) assert.equal(readFileSync(join(directory, file)).includes(Buffer.from('private-alice-api-key')), false);
    store.put(a, { apiKey: 'rotated-key' });
    assert.equal(store.get(a).apiKey, 'rotated-key');
    store.remove(a); assert.equal(store.get(a), null); assert.equal(store.get(b).apiKey, 'private-bob-api-key');
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});
test('startup refuses missing encryption keys', () => assert.throws(() => new Store('.', ''), /ENCRYPTION_KEY/));
