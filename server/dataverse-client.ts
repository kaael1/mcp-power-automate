import { PowerAutomateError, PowerAutomateSessionError } from './errors.js';
import { getTokenAudit } from './token-audit-store.js';
import { getSession } from './session-store.js';
import {
  getDataverseOrgRecord,
  saveDataverseOrgRecord,
} from './dataverse-org-store.js';
import type { DataverseOrgRecord, TokenCandidate } from './schemas.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const BAP_AUDIENCES = new Set([
  'https://api.bap.microsoft.com/',
  'https://api.bap.microsoft.com',
  'https://service.powerapps.com/',
  'https://service.powerapps.com',
]);

const POWERPLATFORM_AUDIENCES = new Set([
  'https://api.powerplatform.com/',
  'https://api.powerplatform.com',
]);

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const safeUrlHost = (value: string): string | null => {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

// Strips an "api." segment (leading or embedded) so org URLs like
// orgabc.api.crm.dynamics.com normalize to orgabc.crm.dynamics.com,
// matching how the JWT aud claim is typically issued.
const normalizeOrgHost = (host: string) =>
  host
    .toLowerCase()
    .replace(/(^|\.)api\.(?=[^.]+\.[^.]+)/, '$1');

const parseAudHost = (aud: string): string | null => {
  const trimmed = stripTrailingSlash(aud);
  const host = safeUrlHost(trimmed);
  if (host) return host.toLowerCase();
  return trimmed.toLowerCase();
};

const isUnexpired = (candidate: TokenCandidate): boolean => {
  if (typeof candidate.exp !== 'number') return true;
  return candidate.exp * 1000 > Date.now();
};

const isLegacyTokenJwt = (token: string): boolean => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

const decodeJwtClaims = (token: string): { aud?: string; exp?: number } | null => {
  try {
    const raw = token.replace(/^Bearer\s+/i, '');
    const [, payload] = raw.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as { aud?: string; exp?: number };
  } catch {
    return null;
  }
};

const sessionLegacyTokenAsCandidate = (): TokenCandidate | null => {
  const session = getSession();
  if (!session?.legacyToken) return null;
  const rawToken = session.legacyToken.replace(/^Bearer\s+/i, '');
  if (!isLegacyTokenJwt(rawToken)) return null;
  const claims = decodeJwtClaims(rawToken);
  if (!claims?.aud) return null;
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null;
  return {
    aud: claims.aud,
    exp: claims.exp ?? null,
    source: 'session-legacy-token',
    token: rawToken,
  };
};

const findCandidateByAudience = (audiences: Set<string>): TokenCandidate | null => {
  const audit = getTokenAudit();
  const fromAudit = audit?.candidates.find((candidate) => {
    if (!isUnexpired(candidate)) return false;
    const aud = stripTrailingSlash(candidate.aud);
    return audiences.has(`${aud}/`) || audiences.has(aud);
  });
  if (fromAudit) return fromAudit;
  const legacy = sessionLegacyTokenAsCandidate();
  if (!legacy) return null;
  const aud = stripTrailingSlash(legacy.aud);
  if (audiences.has(`${aud}/`) || audiences.has(aud)) {
    return legacy;
  }
  return null;
};

export const pickBapToken = (): TokenCandidate | null => findCandidateByAudience(BAP_AUDIENCES);

const sessionApiTokenAsCandidate = (): TokenCandidate | null => {
  const session = getSession();
  if (!session?.apiToken) return null;
  const rawToken = session.apiToken.replace(/^Bearer\s+/i, '');
  if (!isLegacyTokenJwt(rawToken)) return null;
  const claims = decodeJwtClaims(rawToken);
  if (!claims?.aud) return null;
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null;
  return {
    aud: claims.aud,
    exp: claims.exp ?? null,
    source: 'session-api-token',
    token: rawToken,
  };
};

export const pickPowerPlatformToken = (): TokenCandidate | null => {
  const fromAudit = findCandidateByAudience(POWERPLATFORM_AUDIENCES);
  if (fromAudit) return fromAudit;
  // Reuse the modern apiToken from session.json if its audience matches.
  const apiToken = sessionApiTokenAsCandidate();
  if (!apiToken) return null;
  const aud = stripTrailingSlash(apiToken.aud);
  if (POWERPLATFORM_AUDIENCES.has(`${aud}/`) || POWERPLATFORM_AUDIENCES.has(aud)) {
    return apiToken;
  }
  return null;
};

export const pickDataverseToken = (instanceUrl: string): TokenCandidate | null => {
  const audit = getTokenAudit();
  if (!audit) return null;
  const wantHost = safeUrlHost(instanceUrl);
  if (!wantHost) return null;
  const wantOrg = normalizeOrgHost(wantHost);
  return (
    audit.candidates.find((candidate) => {
      if (!isUnexpired(candidate)) return false;
      const audHost = parseAudHost(candidate.aud);
      if (!audHost) return false;
      return normalizeOrgHost(audHost) === wantOrg;
    }) || null
  );
};

export const hasManageSolutionsTokens = (envId: string | null): {
  available: boolean;
  reasonCode: 'BAP_TOKEN_MISSING' | 'DATAVERSE_TOKEN_MISSING' | 'NO_SESSION' | null;
} => {
  if (!envId) {
    return { available: false, reasonCode: 'NO_SESSION' };
  }
  // We can resolve env metadata via either BAP (api.bap.microsoft.com) or
  // Power Platform API (api.powerplatform.com); having either is enough.
  const haveResolver = pickBapToken() || pickPowerPlatformToken();
  if (!haveResolver) {
    return { available: false, reasonCode: 'BAP_TOKEN_MISSING' };
  }
  const cached = getDataverseOrgRecord(envId);
  if (!cached) {
    return { available: true, reasonCode: null };
  }
  const dv = pickDataverseToken(cached.instanceUrl);
  if (!dv) {
    return { available: false, reasonCode: 'DATAVERSE_TOKEN_MISSING' };
  }
  return { available: true, reasonCode: null };
};

export interface DataverseInstance {
  envId: string;
  instanceApiUrl: string;
  instanceUrl: string;
  uniqueName?: string;
}

interface BapEnvironmentResponse {
  properties?: {
    linkedEnvironmentMetadata?: {
      domainName?: string;
      instanceApiUrl?: string;
      instanceUrl?: string;
      uniqueName?: string;
    };
  };
}

const ensureBearer = (token: string): string => (token.startsWith('Bearer ') ? token : `Bearer ${token}`);

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toDataverseError = (response: Response, body: unknown, contextLabel: string): Error => {
  if (response.status === 401 || response.status === 403) {
    return new PowerAutomateSessionError({
      code: 'SESSION_EXPIRED',
      message: `${contextLabel} returned ${response.status}. The Dataverse/BAP token is expired or insufficient. Refresh the maker portal page so the extension can recapture a fresh token.`,
      retryable: true,
    });
  }
  const parsed = body as AnyRecord | string | null;
  const message =
    (parsed as AnyRecord | null)?.error?.['message'] ||
    (parsed as AnyRecord | null)?.['message'] ||
    (typeof parsed === 'string' && parsed) ||
    `${contextLabel} failed with ${response.status} ${response.statusText}.`;
  return new Error(String(message));
};

interface PowerPlatformEnvironmentResponse {
  properties?: {
    linkedEnvironmentMetadata?: {
      domainName?: string;
      instanceApiUrl?: string;
      instanceUrl?: string;
      uniqueName?: string;
    };
  };
}

const fetchInstanceMetadata = async (envId: string): Promise<{
  instanceApiUrl: string;
  instanceUrl: string;
  uniqueName: string | undefined;
} | null> => {
  // Prefer the Power Platform API (api.powerplatform.com) since the user's
  // existing flow MCP captures tokens for that audience automatically.
  const ppt = pickPowerPlatformToken();
  if (ppt) {
    const url = new URL(`https://api.powerplatform.com/environments/${encodeURIComponent(envId)}`);
    url.searchParams.set('api-version', '2022-03-01-preview');
    url.searchParams.set('$expand', 'properties.linkedEnvironmentMetadata');
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: ensureBearer(ppt.token), Accept: 'application/json' },
    });
    if (response.ok) {
      const parsedBody = (await readResponseBody(response)) as PowerPlatformEnvironmentResponse | null;
      const linked = parsedBody?.properties?.linkedEnvironmentMetadata;
      if (linked?.instanceApiUrl && linked.instanceUrl) {
        return {
          instanceApiUrl: stripTrailingSlash(linked.instanceApiUrl),
          instanceUrl: stripTrailingSlash(linked.instanceUrl),
          uniqueName: linked.uniqueName,
        };
      }
    }
    // Fall through to BAP on 401/403 (token rejected) or 404 (route not exposed
    // for our token's scope). api.powerplatform.com gateway routes vary by
    // tenant and audience.
  }

  const bap = pickBapToken();
  if (bap) {
    const url = new URL(
      `https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${encodeURIComponent(envId)}`,
    );
    url.searchParams.set('api-version', '2020-10-01');
    url.searchParams.set('$expand', 'properties.linkedEnvironmentMetadata');
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: ensureBearer(bap.token), Accept: 'application/json' },
    });
    const parsedBody = await readResponseBody(response);
    if (!response.ok) {
      throw toDataverseError(response, parsedBody, 'BAP environment metadata');
    }
    const linked = (parsedBody as BapEnvironmentResponse | null)?.properties?.linkedEnvironmentMetadata;
    if (linked?.instanceApiUrl && linked.instanceUrl) {
      return {
        instanceApiUrl: stripTrailingSlash(linked.instanceApiUrl),
        instanceUrl: stripTrailingSlash(linked.instanceUrl),
        uniqueName: linked.uniqueName,
      };
    }
    throw new PowerAutomateError({
      code: 'DATAVERSE_INSTANCE_NOT_FOUND',
      message: `BAP returned no Dataverse instance for environment ${envId}. The environment may not have a Dataverse database provisioned.`,
      retryable: false,
      details: parsedBody,
    });
  }

  return null;
};

export const resolveInstanceUrl = async (envId: string): Promise<DataverseInstance> => {
  const cached = getDataverseOrgRecord(envId);
  if (cached) {
    return {
      envId: cached.envId,
      instanceApiUrl: cached.instanceApiUrl,
      instanceUrl: cached.instanceUrl,
      uniqueName: cached.uniqueName,
    };
  }

  const metadata = await fetchInstanceMetadata(envId);
  if (!metadata) {
    throw new PowerAutomateError({
      code: 'BAP_TOKEN_MISSING',
      message:
        'No Power Platform admin token captured. Open https://make.powerapps.com/environments/' +
        envId +
        ' (or any Power Automate flow) in the browser with the extension enabled so a token can be captured.',
      retryable: true,
    });
  }

  const record: DataverseOrgRecord = {
    envId,
    instanceApiUrl: metadata.instanceApiUrl,
    instanceUrl: metadata.instanceUrl,
    resolvedAt: new Date().toISOString(),
    uniqueName: metadata.uniqueName,
  };
  await saveDataverseOrgRecord(record);

  return {
    envId,
    instanceApiUrl: record.instanceApiUrl,
    instanceUrl: record.instanceUrl,
    uniqueName: record.uniqueName,
  };
};

export interface DataverseRequestInit {
  body?: unknown;
  headers?: Record<string, string>;
  instance: DataverseInstance;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface DataverseResponse<T = unknown> {
  body: T;
  status: number;
  headers: Record<string, string>;
}

const buildDataverseUrl = (instance: DataverseInstance, path: string, query?: DataverseRequestInit['query']): URL => {
  const trimmedBase = stripTrailingSlash(instance.instanceApiUrl);
  const trimmedPath = path.replace(/^\/+/, '');
  const url = new URL(`${trimmedBase}/api/data/v9.2/${trimmedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
};

export const requestDataverse = async <T = unknown>({
  body,
  headers,
  instance,
  method,
  path,
  query,
}: DataverseRequestInit): Promise<DataverseResponse<T>> => {
  const dv = pickDataverseToken(instance.instanceUrl);
  if (!dv) {
    throw new PowerAutomateError({
      code: 'DATAVERSE_TOKEN_MISSING',
      message:
        'No Dataverse-audience token captured for ' +
        instance.instanceUrl +
        '. Open ' +
        instance.instanceUrl +
        '/main.aspx (or any model-driven app on the org) with the extension enabled to capture one.',
      retryable: true,
    });
  }

  const url = buildDataverseUrl(instance, path, query);
  const isWrite = method === 'POST' || method === 'PATCH' || method === 'PUT';

  const finalHeaders: Record<string, string> = {
    Authorization: ensureBearer(dv.token),
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    ...(isWrite ? {
      'Content-Type': 'application/json; charset=utf-8',
      Prefer: 'return=representation',
    } : {}),
    ...(headers || {}),
  };

  const response = await fetch(url.toString(), {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsedBody = await readResponseBody(response);
  if (!response.ok) {
    throw toDataverseError(response, parsedBody, `Dataverse ${method} ${path}`);
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  return {
    body: (parsedBody as T) ?? (null as unknown as T),
    status: response.status,
    headers: responseHeaders,
  };
};
