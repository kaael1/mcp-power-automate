import type { TokenAudit } from './schemas.js';
import { tokenAuditSchema } from './schemas.js';
import { getDataFilePath } from './runtime-paths.js';
import { readVersionedStore, writeVersionedStore } from './store-utils.js';

const STORE_NAME = 'token-audit';
const STORE_VERSION = 1;

let activeTokenAudit: TokenAudit | null = null;

export const getTokenAudit = () => activeTokenAudit;

export const loadTokenAudit = async () => {
  activeTokenAudit = await readVersionedStore({
    filePath: getDataFilePath('token-audit.json'),
    migrate: (value) => tokenAuditSchema.parse(value),
    name: STORE_NAME,
    parse: (value) => tokenAuditSchema.parse(value),
    version: STORE_VERSION,
  });
  return activeTokenAudit;
};

export const saveTokenAudit = async (audit: TokenAudit) => {
  const parsed = tokenAuditSchema.parse(audit);
  await writeVersionedStore({
    data: parsed,
    filePath: getDataFilePath('token-audit.json'),
    name: STORE_NAME,
    version: STORE_VERSION,
  });
  activeTokenAudit = parsed;
  return parsed;
};

const isExpiredCandidate = (candidate: TokenAudit['candidates'][number]) =>
  typeof candidate.exp === 'number' && candidate.exp * 1000 <= Date.now();

const tokenKey = (token: string) => token.replace(/^Bearer\s+/i, '');

export const mergeTokenAudit = async (audit: TokenAudit) => {
  const parsed = tokenAuditSchema.parse(audit);
  const existing = activeTokenAudit;
  const byToken = new Map<string, TokenAudit['candidates'][number]>();

  for (const candidate of [...parsed.candidates, ...(existing?.candidates || [])]) {
    if (isExpiredCandidate(candidate)) continue;

    const key = tokenKey(candidate.token);
    const current = byToken.get(key);

    if (!current || (candidate.score || 0) >= (current.score || 0)) {
      byToken.set(key, candidate);
    }
  }

  return saveTokenAudit({
    candidates: [...byToken.values()].slice(0, 50),
    capturedAt: parsed.capturedAt || existing?.capturedAt || new Date().toISOString(),
    envId: parsed.envId || existing?.envId,
    flowId: parsed.flowId || existing?.flowId,
    portalUrl: parsed.portalUrl || existing?.portalUrl,
    source: parsed.source || existing?.source || 'token-audit-merge',
  });
};
