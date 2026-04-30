const unwrapBearerToken = (authorization: string | null | undefined) =>
  (authorization || '').replace(/^Bearer\s+/i, '').trim();

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
};

export const decodeJwtPayload = (authorization: string | null | undefined): Record<string, unknown> | null => {
  const token = unwrapBearerToken(authorization);
  const parts = token.split('.');

  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const normalizeAudience = (audience: unknown) =>
  typeof audience === 'string' ? audience.replace(/\/+$/, '').toLowerCase() : '';

export const isLegacyCompatibleAudience = (audience: unknown) =>
  normalizeAudience(audience) === 'https://service.flow.microsoft.com' ||
  normalizeAudience(audience) === 'https://service.powerapps.com';

export const hasLegacyCompatibleToken = (authorization: string | null | undefined) => {
  const payload = decodeJwtPayload(authorization);
  return isLegacyCompatibleAudience(payload?.aud);
};
