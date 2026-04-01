export interface JwtPayload {
  aud?: string;
  exp?: number;
  roles?: string[];
  scp?: string;
}

export interface TokenScore {
  payload: JwtPayload | null;
  scopeText: string;
  score: number;
}

export interface TokenAuditFinding {
  aud: string;
  exp: number | null;
  hasFlowRead: boolean;
  hasFlowWrite: boolean;
  score: number;
  scope: string;
  source: string;
  token: string;
}

export const jwtLike = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;

export const decodeJwtPayload = (token: string) => {
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) return null;

    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
};

export const scoreScopes = (scopeText = '') => {
  const scope = scopeText.toLowerCase();
  let score = 0;

  if (scope.includes('powerautomate.flow.read')) score += 400;
  if (scope.includes('powerautomate.flow.write')) score += 450;
  if (scope.includes('cloudflows')) score += 200;
  if (scope.includes('flows.read')) score += 120;
  if (scope.includes('flows.write')) score += 140;
  if (scope.includes('cloudflows.read')) score += 160;
  if (scope.includes('cloudflows.write')) score += 180;
  if (scope.includes('powerautomate')) score += 40;

  return score;
};

export const scoreToken = (bearerToken: string): TokenScore => {
  const token = bearerToken.replace(/^Bearer\s+/i, '');
  const payload = decodeJwtPayload(token);
  const scopeText = (payload?.scp || payload?.roles?.join(' ') || '').toLowerCase();
  let score = scoreScopes(scopeText);

  if (payload?.aud === 'https://api.powerplatform.com') score += 50;

  return {
    payload,
    scopeText,
    score,
  };
};

export const extractTokenCandidates = (value: unknown) => {
  const candidates = new Set<string>();

  const visit = (input: unknown) => {
    if (!input) return;

    if (typeof input === 'string') {
      const trimmed = input.trim();

      if (trimmed.startsWith('Bearer ')) {
        const token = trimmed.slice(7).trim();
        if (jwtLike.test(token)) candidates.add(token);
      }

      if (jwtLike.test(trimmed)) {
        candidates.add(trimmed);
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          visit(JSON.parse(trimmed));
        } catch {
          return;
        }
      }

      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }

    if (typeof input === 'object') {
      for (const [key, nestedValue] of Object.entries(input)) {
        if (typeof nestedValue === 'string') {
          if (/token|secret|credential/i.test(key) || jwtLike.test(nestedValue.trim())) {
            visit(nestedValue);
            continue;
          }
        }

        visit(nestedValue);
      }
    }
  };

  visit(value);

  return [...candidates];
};

export const buildFinding = ({
  payload,
  scope,
  score,
  source,
  token,
}: {
  payload: JwtPayload;
  scope: string;
  score: number;
  source: string;
  token: string;
}): TokenAuditFinding => ({
  aud: payload.aud ?? '',
  exp: payload.exp ?? null,
  hasFlowRead: scope.toLowerCase().includes('powerautomate.flow.read'),
  hasFlowWrite: scope.toLowerCase().includes('powerautomate.flow.write'),
  score,
  scope,
  source,
  token,
});

export const dedupeFindings = (findings: TokenAuditFinding[]) => {
  const byToken = new Map<string, TokenAuditFinding>();

  for (const finding of findings) {
    const current = byToken.get(finding.token);
    if (!current || (finding.score || 0) >= (current.score || 0)) {
      byToken.set(finding.token, finding);
    }
  }

  return [...byToken.values()];
};
