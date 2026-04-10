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
