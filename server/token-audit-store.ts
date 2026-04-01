import { promises as fs } from 'node:fs';

import type { TokenAudit } from './schemas.js';
import { tokenAuditSchema } from './schemas.js';
import { getDataDir, getDataFilePath } from './runtime-paths.js';

let activeTokenAudit: TokenAudit | null = null;

const ensureDataDir = async () => {
  await fs.mkdir(getDataDir(), { recursive: true });
};

export const getTokenAudit = () => activeTokenAudit;

export const loadTokenAudit = async () => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(getDataFilePath('token-audit.json'), 'utf8');
    activeTokenAudit = tokenAuditSchema.parse(JSON.parse(raw));
    return activeTokenAudit;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      activeTokenAudit = null;
      return null;
    }

    activeTokenAudit = null;
    return null;
  }
};

export const saveTokenAudit = async (audit: TokenAudit) => {
  const parsed = tokenAuditSchema.parse(audit);
  await ensureDataDir();
  await fs.writeFile(getDataFilePath('token-audit.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  activeTokenAudit = parsed;
  return parsed;
};
