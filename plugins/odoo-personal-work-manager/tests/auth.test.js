import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { jwtAuthenticator } from '../server/auth.js';

test('JWT auth enforces signature, issuer, audience, expiry and subject', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test', alg: 'RS256' }] });
  const authenticate = jwtAuthenticator({ issuer: 'https://id.example.com/', audience: 'https://work.example.com/mcp', jwks });
  const token = overrides => new SignJWT({ sub: 'alice', iss: 'https://id.example.com/', aud: 'https://work.example.com/mcp', exp: Math.floor(Date.now() / 1000) + 300, scope: 'odoo:read odoo:write', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey);
  const request = value => ({ headers: { authorization: `Bearer ${value}` } });
  assert.deepEqual((await authenticate(request(await token({})))).scopes, ['odoo:read', 'odoo:write']);
  for (const override of [{ iss: 'https://attacker.example.com' }, { aud: 'https://other.example.com/mcp' }, { exp: 1 }, { exp: undefined }, { sub: undefined }]) await assert.rejects(authenticate(request(await token(override))));
  await assert.rejects(authenticate(request(`${await token({})}tampered`)));
  await assert.rejects(authenticate({ headers: {} }));
});
