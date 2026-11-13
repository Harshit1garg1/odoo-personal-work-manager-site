import { jwtVerify } from 'jose';

export function jwtAuthenticator({ issuer, audience, jwks }) {
  return async request => {
    const header = request.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw new Error('Missing bearer token.');
    const { payload } = await jwtVerify(header.slice(7), jwks, { issuer, audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'iss', 'aud', 'exp'] });
    return { ...payload, scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : Array.isArray(payload.scp) ? payload.scp.filter(s => typeof s === 'string') : [] };
  };
}
