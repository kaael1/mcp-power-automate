import type { CapabilityReasonCode } from './bridge-types.js';
import { getDataverseOrgRecord, saveDataverseOrgRecord } from './dataverse-org-store.js';
import { PowerAutomateError, PowerAutomateSessionError } from './errors.js';
import type { DataverseOrgRecord, TokenCandidate } from './schemas.js';
import { getSession } from './session-store.js';
import { getTokenAudit } from './token-audit-store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const BAP_AUDIENCES = new Set(['https://api.bap.microsoft.com', 'https://service.powerapps.com']);
const POWER_PLATFORM_AUDIENCES = new Set(['https://api.powerplatform.com']);
const MAX_DATAVERSE_PAGES = 100;

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const ensureBearer = (token: string) => (token.startsWith('Bearer ') ? token : `Bearer ${token}`);

const normalizeAudience = (audience: string) => stripTrailingSlash(audience).toLowerCase();

const safeUrlHost = (value: string): string | null => {
  try {
    return new URL(stripTrailingSlash(value)).host.toLowerCase();
  } catch {
    return null;
  }
};

const normalizeOrgHost = (host: string) => host.toLowerCase().replace(/(^|\.)api\.(?=[^.]+\.[^.]+)/, '$1');

const parseAudienceHost = (audience: string) => safeUrlHost(audience) || normalizeAudience(audience);

const isJwtLike = (token: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

const decodeJwtClaims = (token: string): { aud?: string; exp?: number } | null => {
  try {
    const rawToken = token.replace(/^Bearer\s+/i, '');
    if (!isJwtLike(rawToken)) return null;

    const [, payload] = rawToken.split('.');
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { aud?: string; exp?: number };
  } catch {
    return null;
  }
};

const isUnexpired = (candidate: TokenCandidate) =>
  typeof candidate.exp === 'number' ? candidate.exp * 1000 > Date.now() : true;

const sessionTokenAsCandidate = (token: string | null | undefined, source: string): TokenCandidate | null => {
  if (!token) return null;

  const claims = decodeJwtClaims(token);
  if (!claims?.aud) return null;
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null;

  return {
    aud: claims.aud,
    exp: claims.exp ?? null,
    source,
    token,
  };
};

const findAuditCandidateByAudience = (audiences: Set<string>) => {
  const candidates = getTokenAudit()?.candidates || [];

  return (
    candidates.find((candidate) => isUnexpired(candidate) && audiences.has(normalizeAudience(candidate.aud))) || null
  );
};

const findTokenByAudience = (audiences: Set<string>) => {
  const fromAudit = findAuditCandidateByAudience(audiences);
  if (fromAudit) return fromAudit;

  const session = getSession();
  const fallbacks = [
    sessionTokenAsCandidate(session?.apiToken, 'session-api-token'),
    sessionTokenAsCandidate(session?.legacyToken, 'session-legacy-token'),
  ];

  return fallbacks.find((candidate) => candidate && audiences.has(normalizeAudience(candidate.aud))) || null;
};

export const pickBapToken = (): TokenCandidate | null => findTokenByAudience(BAP_AUDIENCES);

export const pickPowerPlatformToken = (): TokenCandidate | null => findTokenByAudience(POWER_PLATFORM_AUDIENCES);

export const pickDataverseToken = (instanceUrl: string): TokenCandidate | null => {
  const wantHost = safeUrlHost(instanceUrl);
  if (!wantHost) return null;

  const wantOrgHost = normalizeOrgHost(wantHost);

  return (
    getTokenAudit()?.candidates.find((candidate) => {
      if (!isUnexpired(candidate)) return false;

      const audienceHost = parseAudienceHost(candidate.aud);
      return normalizeOrgHost(audienceHost) === wantOrgHost;
    }) || null
  );
};

const pickAnyDataverseToken = (): TokenCandidate | null =>
  getTokenAudit()?.candidates.find((candidate) => {
    if (!isUnexpired(candidate)) return false;

    const audienceHost = parseAudienceHost(candidate.aud);
    return audienceHost.endsWith('.dynamics.com');
  }) || null;

export const hasManageSolutionsTokens = (
  envId: string | null,
): { available: boolean; reasonCode: CapabilityReasonCode | null } => {
  if (!envId) {
    return { available: false, reasonCode: 'NO_SESSION' };
  }

  const cachedOrg = getDataverseOrgRecord(envId);

  if (cachedOrg) {
    if (!pickDataverseToken(cachedOrg.instanceUrl)) {
      return { available: false, reasonCode: 'DATAVERSE_TOKEN_MISSING' };
    }

    return { available: true, reasonCode: null };
  }

  if (!pickPowerPlatformToken() && !pickBapToken()) {
    return { available: false, reasonCode: 'BAP_TOKEN_MISSING' };
  }

  if (!pickAnyDataverseToken()) {
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

interface EnvironmentMetadataResponse {
  properties?: {
    linkedEnvironmentMetadata?: {
      domainName?: string;
      instanceApiUrl?: string;
      instanceUrl?: string;
      uniqueName?: string;
    };
  };
}

const readResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const extractApiMessage = (body: unknown, fallback: string) => {
  const parsed = body as AnyRecord | string | null;
  return (
    (parsed as AnyRecord | null)?.error?.message ||
    (parsed as AnyRecord | null)?.message ||
    (typeof parsed === 'string' ? parsed : '') ||
    fallback
  );
};

const toDataverseError = (response: Response, body: unknown, label: string): Error => {
  if (response.status === 401 || response.status === 403) {
    return new PowerAutomateSessionError({
      code: 'SESSION_EXPIRED',
      message: `${label} returned ${response.status}. Refresh the maker or Dataverse page so the extension can capture fresh tokens.`,
      retryable: true,
    });
  }

  return new PowerAutomateError({
    code: 'UNKNOWN',
    details: {
      body,
      status: response.status,
    },
    message: extractApiMessage(body, `${label} failed with ${response.status} ${response.statusText}.`),
    retryable: false,
  });
};

const readLinkedMetadata = (body: unknown) => (body as EnvironmentMetadataResponse | null)?.properties?.linkedEnvironmentMetadata;

const fetchPowerPlatformMetadata = async (envId: string) => {
  const token = pickPowerPlatformToken();
  if (!token) return null;

  const url = new URL(`https://api.powerplatform.com/environments/${encodeURIComponent(envId)}`);
  url.searchParams.set('api-version', '2022-03-01-preview');
  url.searchParams.set('$expand', 'properties.linkedEnvironmentMetadata');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: ensureBearer(token.token),
    },
    method: 'GET',
  });
  const body = await readResponseBody(response);

  if (!response.ok) return null;

  return readLinkedMetadata(body) || null;
};

const fetchBapMetadata = async (envId: string) => {
  const token = pickBapToken();
  if (!token) return null;

  const url = new URL(
    `https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments/${encodeURIComponent(envId)}`,
  );
  url.searchParams.set('api-version', '2020-10-01');
  url.searchParams.set('$expand', 'properties.linkedEnvironmentMetadata');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: ensureBearer(token.token),
    },
    method: 'GET',
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw toDataverseError(response, body, 'BAP environment metadata');
  }

  return readLinkedMetadata(body) || null;
};

export const resolveInstanceUrl = async (envId: string): Promise<DataverseInstance> => {
  const cached = getDataverseOrgRecord(envId);
  if (cached) return cached;

  const metadata = (await fetchPowerPlatformMetadata(envId)) || (await fetchBapMetadata(envId));

  if (!metadata) {
    throw new PowerAutomateError({
      code: 'BAP_TOKEN_MISSING',
      message: `No Power Platform/BAP token is available for environment ${envId}. Open make.powerapps.com or make.powerautomate.com in that environment with the extension enabled.`,
      retryable: true,
    });
  }

  if (!metadata.instanceApiUrl || !metadata.instanceUrl) {
    throw new PowerAutomateError({
      code: 'DATAVERSE_INSTANCE_NOT_FOUND',
      details: metadata,
      message: `No Dataverse organization was found for environment ${envId}.`,
      retryable: false,
    });
  }

  const record: DataverseOrgRecord = {
    envId,
    instanceApiUrl: stripTrailingSlash(metadata.instanceApiUrl),
    instanceUrl: stripTrailingSlash(metadata.instanceUrl),
    resolvedAt: new Date().toISOString(),
    uniqueName: metadata.uniqueName,
  };
  await saveDataverseOrgRecord(record);

  return record;
};

export interface DataverseRequestInit {
  body?: unknown;
  instance: DataverseInstance;
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, boolean | number | string | undefined>;
}

export interface DataverseResponse<T = unknown> {
  body: T;
  headers: Record<string, string>;
  status: number;
}

interface DataverseCollectionBody<T> {
  '@odata.nextLink'?: string;
  value?: T[];
}

const buildDataverseUrl = (instance: DataverseInstance, path: string, query?: DataverseRequestInit['query']) => {
  const url = new URL(`${stripTrailingSlash(instance.instanceApiUrl)}/api/data/v9.2/${path.replace(/^\/+/, '')}`);

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
};

const assertDataverseUrlForInstance = (instance: DataverseInstance, url: URL) => {
  const actualHost = normalizeOrgHost(url.host);
  const allowedHosts = [safeUrlHost(instance.instanceApiUrl), safeUrlHost(instance.instanceUrl)]
    .filter((host): host is string => Boolean(host))
    .map(normalizeOrgHost);

  if (!allowedHosts.includes(actualHost)) {
    throw new PowerAutomateError({
      code: 'INVALID_REQUEST',
      details: {
        allowedHosts,
        nextLinkHost: url.host,
      },
      message: 'Dataverse paging returned a nextLink for a different organization.',
      retryable: false,
    });
  }
};

const buildNextLinkUrl = (instance: DataverseInstance, nextLink: string) => {
  const url = new URL(nextLink, `${stripTrailingSlash(instance.instanceApiUrl)}/api/data/v9.2/`);
  assertDataverseUrlForInstance(instance, url);
  return url;
};

const requestDataverseUrl = async <T = unknown>({
  body,
  instance,
  method = 'GET',
  url,
  label,
}: {
  body?: unknown;
  instance: DataverseInstance;
  label: string;
  method?: 'GET' | 'POST';
  url: URL;
}): Promise<DataverseResponse<T>> => {
  const token = pickDataverseToken(instance.instanceUrl);

  if (!token) {
    throw new PowerAutomateError({
      code: 'DATAVERSE_TOKEN_MISSING',
      message: `No Dataverse token is available for ${instance.instanceUrl}. Open that Dataverse org or a model-driven app with the extension enabled.`,
      retryable: true,
    });
  }

  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      Authorization: ensureBearer(token.token),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
    method,
  });
  const parsedBody = await readResponseBody(response);

  if (!response.ok) {
    throw toDataverseError(response, parsedBody, label);
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  return {
    body: (parsedBody as T) ?? (null as T),
    headers: responseHeaders,
    status: response.status,
  };
};

export const requestDataverse = async <T = unknown>({
  body,
  instance,
  method = 'GET',
  path,
  query,
}: DataverseRequestInit): Promise<DataverseResponse<T>> =>
  requestDataverseUrl({
    body,
    instance,
    label: `Dataverse ${method} ${path}`,
    method,
    url: buildDataverseUrl(instance, path, query),
  });

export const requestDataverseCollection = async <T = unknown>({
  instance,
  path,
  query,
}: Omit<DataverseRequestInit, 'method'>) => {
  const firstPage = await requestDataverse<DataverseCollectionBody<T>>({
    instance,
    method: 'GET',
    path,
    query,
  });
  const value = [...(firstPage.body?.value || [])];
  let nextLink = firstPage.body?.['@odata.nextLink'];
  let pageCount = 1;

  while (nextLink) {
    if (pageCount >= MAX_DATAVERSE_PAGES) {
      throw new PowerAutomateError({
        code: 'UNKNOWN',
        message: `Dataverse ${path} returned more than ${MAX_DATAVERSE_PAGES} pages.`,
        retryable: false,
      });
    }

    const page = await requestDataverseUrl<DataverseCollectionBody<T>>({
      instance,
      label: `Dataverse GET ${path} next page`,
      method: 'GET',
      url: buildNextLinkUrl(instance, nextLink),
    });

    value.push(...(page.body?.value || []));
    nextLink = page.body?.['@odata.nextLink'];
    pageCount += 1;
  }

  return {
    pageCount,
    value,
  };
};
