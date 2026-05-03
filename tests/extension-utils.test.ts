import { beforeEach, describe, expect, it } from 'vitest';

import { dedupeFindings, extractTokenCandidates, isTokenExpired, scoreScopes, scoreToken } from '../extension/token-utils.js';
import { buildBaseUrl, extractFromApiUrl, extractFromPortalUrl } from '../extension/url-utils.js';

const encodeJwt = (payload: Record<string, unknown>) => {
  const base64 = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${base64}.${base64}.${base64}`;
};

describe('extension helpers', () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      atob: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
    });
  });

  it('extracts nested token candidates from structured strings', () => {
    const token = encodeJwt({ aud: 'https://api.powerplatform.com', scp: 'PowerAutomate.Flow.Read' });
    const candidates = extractTokenCandidates({
      nested: JSON.stringify({
        accessToken: `Bearer ${token}`,
      }),
    });

    expect(candidates).toEqual([token]);
  });

  it('scores tokens and deduplicates findings by strongest score', () => {
    const token = `Bearer ${encodeJwt({
      aud: 'https://api.powerplatform.com',
      scp: 'PowerAutomate.Flow.Read PowerAutomate.Flow.Write',
    })}`;

    expect(scoreScopes('PowerAutomate.Flow.Read PowerAutomate.Flow.Write')).toBeGreaterThan(800);
    expect(scoreToken(token).score).toBeGreaterThan(800);
    expect(
      dedupeFindings([
        {
          aud: 'https://api.powerplatform.com',
          exp: null,
          hasFlowRead: true,
          hasFlowWrite: false,
          score: 100,
          scope: 'read',
          source: 'a',
          token,
        },
        {
          aud: 'https://api.powerplatform.com',
          exp: null,
          hasFlowRead: true,
          hasFlowWrite: true,
          score: 500,
          scope: 'write',
          source: 'b',
          token,
        },
      ]),
    ).toEqual([
      {
        aud: 'https://api.powerplatform.com',
        exp: null,
        hasFlowRead: true,
        hasFlowWrite: true,
        score: 500,
        scope: 'write',
        source: 'b',
        token,
      },
    ]);
  });

  it('parses flow identifiers from portal and API URLs', () => {
    expect(
      extractFromApiUrl(
        'https://tenant.api.powerplatform.com/powerautomate/flows/123e4567-e89b-12d3-a456-426614174000',
      ),
    ).toEqual({
      envId: null,
      flowId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(
      extractFromPortalUrl(
        'https://make.powerautomate.com/environments/Default-123/flows/123e4567-e89b-12d3-a456-426614174000/details',
      ),
    ).toEqual({
      envId: 'Default-123',
      flowId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(buildBaseUrl('https://tenant.api.flow.microsoft.com/providers/test')).toBe(
      'https://tenant.api.flow.microsoft.com/',
    );
  });
});

describe('isTokenExpired', () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      atob: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
    });
  });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it('returns true for an empty / missing token', () => {
    expect(isTokenExpired('')).toBe(true);
  });

  it('returns true for a token whose `exp` is in the past', () => {
    const token = encodeJwt({ aud: 'https://service.flow.microsoft.com', exp: nowSeconds() - 600 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for a token with no `exp` claim (cannot verify freshness)', () => {
    const token = encodeJwt({ aud: 'https://service.flow.microsoft.com' });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true within the default 60s safety skew', () => {
    const token = encodeJwt({ aud: 'https://service.flow.microsoft.com', exp: nowSeconds() + 30 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns false for a comfortably-fresh token', () => {
    const token = encodeJwt({ aud: 'https://service.flow.microsoft.com', exp: nowSeconds() + 1800 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('respects the Bearer prefix', () => {
    const token = `Bearer ${encodeJwt({ aud: 'x', exp: nowSeconds() + 1800 })}`;
    expect(isTokenExpired(token)).toBe(false);
  });

  it('honours a caller-supplied skew', () => {
    const token = encodeJwt({ aud: 'x', exp: nowSeconds() + 120 });
    expect(isTokenExpired(token, 60)).toBe(false);
    expect(isTokenExpired(token, 200)).toBe(true);
  });
});
