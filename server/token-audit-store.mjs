import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenAuditSchema } from './schemas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'data');
const auditFilePath = path.join(dataDir, 'token-audit.json');

let activeTokenAudit = null;

const ensureDataDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

export const getTokenAudit = () => activeTokenAudit;

export const loadTokenAudit = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(auditFilePath, 'utf8');
    activeTokenAudit = tokenAuditSchema.parse(JSON.parse(raw));
    return activeTokenAudit;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      activeTokenAudit = null;
      return null;
    }

    activeTokenAudit = null;
    return null;
  }
};

export const saveTokenAudit = async (audit) => {
  const parsed = tokenAuditSchema.parse(audit);
  await ensureDataDir();
  await fs.writeFile(auditFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeTokenAudit = parsed;
  return parsed;
};
