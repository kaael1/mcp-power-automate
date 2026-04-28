import { PowerAutomateError, PowerAutomateSessionError } from './errors.js';
import { getTokenAudit } from './token-audit-store.js';
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

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const safeUrlHost = (value: string): string | null => {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

// Strips a leading "api." segment so api.crm.dynamics.com matches crm.dynamics.com.
const normalizeOrgHost = (host: string) => host.replace(/^api\./, '').toLowerCase();

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

export const pickBapToken = (): TokenCandidate | null => {
  const audit = getTokenAudit();
  if (!audit) return null;
  return (
    audit.candidates.find((candidate) => {
      if (!isUnexpired(candidate)) return false;
      const aud = stripTrailingSlash(candidate.aud);
      return BAP_AUDIENCES.has(`${aud}/`) || BAP_AUDIENCES.has(aud);
    }) || null
  );
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
  const bap = pickBapToken();
  if (!bap) {
    return { available: false, reasonCode: 'BAP_TOKEN_MISSING' };
  }
  const cached = getDataverseOrgRecord(envId);
  if (!cached) {
    // Not yet resolved — but BAP token is present so we can resolve. Mark available
    // so the capability shows true, deferring instance-URL fetch to first use.
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

  const bap = pickBapToken();
  if (!bap) {
    throw new PowerAutomateError({
      code: 'BAP_TOKEN_MISSING',
      message:
        'No Business Application Platform (BAP) token captured. Open https://make.powerapps.com/environments/' +
        envId +
        ' in the browser with the extension enabled so a BAP token can be captured.',
      retryable: true,
    });
  }

  const url = new URL(
    `https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${encodeURIComponent(envId)}`,
  );
  url.searchParams.set('api-version', '2020-10-01');
  url.searchParams.set('$expand', 'properties.linkedEnvironmentMetadata');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: ensureBearer(bap.token),
      Accept: 'application/json',
    },
  });
  const parsedBody = await readResponseBody(response);
  if (!response.ok) {
    throw toDataverseError(response, parsedBody, 'BAP environment metadata');
  }

  const linked = (parsedBody as BapEnvironmentResponse | null)?.properties?.linkedEnvironmentMetadata;
  if (!linked?.instanceApiUrl || !linked?.instanceUrl) {
    throw new PowerAutomateError({
      code: 'DATAVERSE_INSTANCE_NOT_FOUND',
      message:
        'BAP returned no Dataverse instance for environment ' +
        envId +
        '. The environment may not have a Dataverse database provisioned.',
      retryable: false,
      details: parsedBody,
    });
  }

  const record: DataverseOrgRecord = {
    envId,
    instanceApiUrl: stripTrailingSlash(linked.instanceApiUrl),
    instanceUrl: stripTrailingSlash(linked.instanceUrl),
    resolvedAt: new Date().toISOString(),
    uniqueName: linked.uniqueName,
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
