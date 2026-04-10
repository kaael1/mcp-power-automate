import { describe, expect, it } from 'vitest';

import { decodeJwtPayload, hasLegacyCompatibleToken, isLegacyCompatibleAudience } from '../server/token-compat.js';

const encodeJwt = (payload: Record<string, unknown>) => {
  const base64 = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${base64}.${base64}.${base64}`;
};

describe('token compat helpers', () => {
  it('detects a session token that is already legacy-compatible', () => {
    const token = `Bearer ${encodeJwt({ aud: 'https://service.flow.microsoft.com/' })}`;

    expect(hasLegacyCompatibleToken(token)).toBe(true);
    expect(decodeJwtPayload(token)).toMatchObject({
      aud: 'https://service.flow.microsoft.com/',
    });
  });

  it('rejects modern-only audiences as a legacy fallback', () => {
    const token = `Bearer ${encodeJwt({ aud: 'https://api.powerplatform.com' })}`;

    expect(hasLegacyCompatibleToken(token)).toBe(false);
  });

  it('recognizes both supported legacy audiences', () => {
    expect(isLegacyCompatibleAudience('https://service.flow.microsoft.com/')).toBe(true);
    expect(isLegacyCompatibleAudience('https://service.powerapps.com/')).toBe(true);
    expect(isLegacyCompatibleAudience('something-else')).toBe(false);
  });
});
