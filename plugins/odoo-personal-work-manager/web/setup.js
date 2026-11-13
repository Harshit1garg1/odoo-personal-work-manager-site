const $ = id => document.getElementById(id);
const config = await fetch('/setup/config').then(r => r.json());
const feedback = (message, error = false) => { $('feedback').textContent = message; $('feedback').className = error ? 'error' : ''; };
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
function signedIn() {
  const token = sessionStorage.getItem('odoo-work-token');
  $('sign-in').hidden = !!token || config.demo; $('sign-out').hidden = !token; $('connection').hidden = !token || config.demo; $('demo-banner').hidden = !config.demo;
}
async function request(method, body) {
  const response = await fetch('/api/connection', { method, headers: { Authorization: `Bearer ${sessionStorage.getItem('odoo-work-token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || 'Connection failed.');
  return value;
}
$('sign-in').addEventListener('click', async () => {
  try {
    if (!config.authorizationEndpoint?.startsWith('https://') || !config.tokenEndpoint?.startsWith('https://') || !config.clientId) throw new Error('The administrator must configure the identity provider and setup client first.');
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48))), state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem('odoo-work-pkce', JSON.stringify({ verifier, state, created: Date.now() }));
    const url = new URL(config.authorizationEndpoint);
    for (const [key, value] of Object.entries({ client_id: config.clientId, response_type: 'code', redirect_uri: config.redirectUri, scope: config.scopes, resource: config.resource, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    location.assign(url);
  } catch (error) { feedback(error.message, true); }
});
if (location.pathname === '/setup/callback') {
  const params = new URLSearchParams(location.search);
  history.replaceState({}, '', '/setup');
  try {
    const saved = JSON.parse(sessionStorage.getItem('odoo-work-pkce') || '{}'); sessionStorage.removeItem('odoo-work-pkce');
    if (!params.get('code') || !saved.state || params.get('state') !== saved.state || Date.now() - saved.created > 600000) throw new Error('Sign-in expired or its state did not match. Start again.');
    if (!config.tokenEndpoint?.startsWith('https://')) throw new Error('Invalid identity provider configuration.');
    const response = await fetch(config.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, code: params.get('code'), code_verifier: saved.verifier, redirect_uri: config.redirectUri, resource: config.resource }) });
    const data = await response.json();
    if (!response.ok || !data.access_token || data.token_type?.toLowerCase() !== 'bearer') throw new Error('Sign-in failed. Check the provider client and resource configuration.');
    sessionStorage.setItem('odoo-work-token', data.access_token); feedback('Signed in. Connect your Odoo account below.');
  } catch (error) { feedback(error.message, true); }
}
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const form = event.currentTarget;
  try {
    const data = Object.fromEntries(new FormData(form));
    const result = await request('POST', data); form.elements.apiKey.value = '';
    $('connection-status').textContent = `Connected as ${result.user.name} · ${result.company.name} · ${result.timezone}`;
    feedback('Connection verified. You can now open the dashboard or connect the MCP server in ChatGPT.');
  } catch (error) { form.elements.apiKey.value = ''; feedback(error.message, true); }
  finally { button.disabled = false; }
});
$('disconnect').addEventListener('click', async () => { try { await request('DELETE'); feedback('Stored connection deleted. Revoke the key in Odoo as well.'); $('connection-status').textContent = 'Disconnected.'; } catch (error) { feedback(error.message, true); } });
$('sign-out').addEventListener('click', () => { sessionStorage.removeItem('odoo-work-token'); signedIn(); feedback('Signed out of this browser. Use Disconnect to remove the stored Odoo connection.'); });
signedIn();
