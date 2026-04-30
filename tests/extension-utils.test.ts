import { beforeEach, describe, expect, it } from 'vitest';

import { dedupeFindings, extractTokenCandidates, scoreScopes, scoreToken } from '../extension/token-utils.js';
import { buildBaseUrl, extractBestFlowLocation, extractFromApiUrl, extractFromPortalUrl } from '../extension/url-utils.js';

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

  it('resolves flow context from parent/referrer URL candidates', () => {
    expect(
      extractBestFlowLocation([
        'https://designer.powerapps.com/app/index.html',
        'https://make.powerautomate.com/environments/Default-123/solutions/~preferred/flows/123e4567-e89b-12d3-a456-426614174000?v3=true',
      ]),
    ).toEqual({
      envId: 'Default-123',
      flowId: '123e4567-e89b-12d3-a456-426614174000',
      portalUrl:
        'https://make.powerautomate.com/environments/Default-123/solutions/~preferred/flows/123e4567-e89b-12d3-a456-426614174000?v3=true',
    });
  });
});
