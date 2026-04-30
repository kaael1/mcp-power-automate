export interface FlowLocation {
  envId: string | null;
  flowId: string | null;
}

export interface FlowLocationWithPortal extends FlowLocation {
  portalUrl: string | null;
}

export const extractAuthorization = (headers: Array<{ name: string; value?: string }> = []) => {
  const header = headers.find((item) => item.name.toLowerCase() === 'authorization');
  return header?.value || null;
};

export const extractFromApiUrl = (requestUrl: string): FlowLocation | null => {
  const modernMatch = requestUrl.match(/\.api\.powerplatform\.com\/powerautomate\/flows\/([0-9a-f-]{36})/i);

  if (modernMatch) {
    return { envId: null, flowId: modernMatch[1] ?? null };
  }

  const legacyMatch = requestUrl.match(
    /\/providers\/Microsoft\.ProcessSimple\/environments\/([^/]+)\/flows\/([0-9a-f-]{36})/i,
  );

  if (legacyMatch) {
    return { envId: legacyMatch[1] ?? null, flowId: legacyMatch[2] ?? null };
  }

  return null;
};

export const extractFromPortalUrl = (portalUrl: string | null | undefined): FlowLocation | null => {
  if (!portalUrl) return null;

  const envMatch = portalUrl.match(/environments\/([a-zA-Z0-9-]+)/i);
  const flowMatch = portalUrl.match(/flows\/([0-9a-f-]{36})/i);

  if (!envMatch && !flowMatch) return null;

  return {
    envId: envMatch?.[1] || null,
    flowId: flowMatch?.[1] || null,
  };
};

export const extractBestFlowLocation = (urls: Array<string | null | undefined>): FlowLocationWithPortal => {
  let envId: string | null = null;
  let flowId: string | null = null;
  let portalUrl: string | null = null;

  for (const candidateUrl of urls) {
    if (!candidateUrl) continue;

    const parsed = extractFromPortalUrl(candidateUrl);
    if (!parsed) {
      if (!portalUrl) portalUrl = candidateUrl;
      continue;
    }

    envId ||= parsed.envId;
    flowId ||= parsed.flowId;
    portalUrl = candidateUrl;

    if (envId && flowId) break;
  }

  return {
    envId,
    flowId,
    portalUrl,
  };
};

export const buildBaseUrl = (rawUrl: string) => {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.hostname}/`;
};
