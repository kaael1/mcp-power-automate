import { createHash } from 'node:crypto';

import { isPlainObject } from './client-helpers.js';

const toCanonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(toCanonicalJson).join(',')}]`;

  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${toCanonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};

// Fingerprint of the flow a caller edited from: display name plus flow body. Key order is ignored so live API reads
// and browser snapshots of the same flow hash identically; a missing display name hashes as an empty one.
export const computeFlowBaseHash = ({
  displayName,
  flow: { connectionReferences, definition },
}: {
  displayName?: string;
  flow: {
    connectionReferences: Record<string, unknown>;
    definition: Record<string, unknown>;
  };
}): string =>
  createHash('sha256')
    .update(toCanonicalJson({ connectionReferences, definition, displayName: displayName ?? '' }))
    .digest('hex');
