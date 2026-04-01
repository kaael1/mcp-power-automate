import { describe, expect, it } from 'vitest';

import { flowCatalogItemSchema, sessionSchema, waitForRunInputSchema } from '../server/schemas.js';

describe('schemas', () => {
  it('parses a valid session payload', () => {
    const session = sessionSchema.parse({
      apiToken: 'Bearer token',
      apiUrl: 'https://example.api.powerplatform.com/',
      capturedAt: '2026-04-01T00:00:00.000Z',
      envId: 'Default-123',
      flowId: '123e4567-e89b-12d3-a456-426614174000',
      legacyApiUrl: 'https://api.flow.microsoft.com/',
      legacyToken: 'Bearer legacy',
      portalUrl: 'https://make.powerautomate.com/environments/Default-123/flows/123e4567-e89b-12d3-a456-426614174000',
    });

    expect(session.envId).toBe('Default-123');
    expect(session.legacyApiUrl).toBe('https://api.flow.microsoft.com/');
  });

  it('rejects invalid flow catalog items', () => {
    expect(() =>
      flowCatalogItemSchema.parse({
        displayName: '',
        envId: 'Default-123',
        flowId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    ).toThrowError(/displayName is required/i);
  });

  it('limits wait-for-run polling inputs', () => {
    expect(() => waitForRunInputSchema.parse({ pollIntervalSeconds: 31 })).toThrowError(/too_big/i);
    expect(waitForRunInputSchema.parse({ pollIntervalSeconds: 5, timeoutSeconds: 30 })).toEqual({
      pollIntervalSeconds: 5,
      timeoutSeconds: 30,
    });
  });
});
