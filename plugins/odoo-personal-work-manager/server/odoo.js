import { lookup } from 'node:dns';
import { Agent, fetch } from 'undici';
import ipaddr from 'ipaddr.js';

export class WorkError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const split = value => (value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function validateHost(baseUrl, allowedHosts) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new WorkError('INVALID_HOST', 'Enter a valid HTTPS Odoo base URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || (url.port && url.port !== '443')) {
    throw new WorkError('INVALID_HOST', 'Use an HTTPS base URL without a path, credentials, query, or custom port.');
  }
  if (ipaddr.isValid(url.hostname.replace(/^\[|\]$/g, ''))) throw new WorkError('INVALID_HOST', 'Use an approved DNS hostname, not an IP address.');
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new WorkError('HOST_NOT_ALLOWED', 'An administrator must approve this exact Odoo hostname before connection.');
  return url.origin;
}
export class OdooClient {
  constructor({ allowedHosts = split(process.env.ODOO_ALLOWED_HOSTS), privateHosts = split(process.env.ODOO_PRIVATE_HOSTS), fetchImpl = fetch } = {}) {
    this.allowedHosts = allowedHosts; this.privateHosts = privateHosts; this.fetch = fetchImpl; this.agents = new Map();
  }
  dispatcher(host) {
    if (!this.agents.has(host)) {
      const allowPrivate = this.privateHosts.includes(host);
      this.agents.set(host, new Agent({ connect: { lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || (!allowPrivate && addresses.some(a => !publicAddress(a.address)))) return callback(new Error('Odoo hostname resolved to a prohibited network address.'));
          // The checked addresses are returned directly to the socket: no second DNS resolution.
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      } } }));
    }
    return this.agents.get(host);
  }
  async call(connection, operation, args = {}) {
    const origin = validateHost(connection.baseUrl, this.allowedHosts), host = new URL(origin).hostname;
    if (!['context', 'describe', 'people', 'list', 'prepare', 'execute', 'result'].includes(operation)) throw new WorkError('INVALID_OPERATION', 'Unsupported connector operation.');
    const adapter = connection.transport === 'adapter';
    const url = adapter ? `${origin}/odoo-work/v1/${operation}` : `${origin}/json/2/odoo.work.service/work_${operation}`;
    let response;
    try {
      response = await this.fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), dispatcher: this.dispatcher(host),
        headers: { 'Content-Type': 'application/json', Authorization: `bearer ${connection.apiKey}`, ...(connection.database ? { 'X-Odoo-Database': connection.database } : {}) },
        body: JSON.stringify({ payload: args })
      });
    } catch { throw new WorkError('CONNECTION_FAILED', 'Odoo could not be reached securely. Check the host, TLS, network and adapter installation. A submitted write may have committed; retrieve its operation result before retrying.'); }
    let raw = '', size = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2_000_000) throw new WorkError('RESPONSE_TOO_LARGE', 'Narrow the Odoo request.');
      raw += decoder.decode(chunk, { stream: true });
    }
    raw += decoder.decode();
    let data;
    try { data = JSON.parse(raw); } catch { throw new WorkError('INVALID_RESPONSE', `Odoo did not return JSON (HTTP ${response.status}). Check the endpoint and addon installation.`); }
    if (!response.ok) {
      // Return business validation messages only. Never forward Odoo tracebacks or request details.
      const business = ['odoo.exceptions.AccessError', 'odoo.exceptions.UserError', 'odoo.exceptions.ValidationError'].includes(data.name);
      throw new WorkError(response.status === 401 ? 'ODOO_AUTH' : 'ODOO_HTTP', business ? String(data.message).slice(0, 1000) : `Odoo returned HTTP ${response.status}. Check API access, key expiry, permissions and addon installation.`);
    }
    if (data.error) throw new WorkError(data.error.code || 'ODOO_ERROR', data.error.message || 'Odoo rejected this operation.');
    return data;
  }
  async close() { await Promise.all([...this.agents.values()].map(a => a.close())); }
}
