export type PowerAutomateErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'CALLBACK_URL_MISSING'
  | 'CONNECTION_AUTHORIZATION_FAILED'
  | 'NO_SESSION'
  | 'NO_TARGET'
  | 'FLOW_NOT_FOUND'
  | 'LEGACY_TOKEN_MISSING'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'SESSION_EXPIRED'
  | 'TARGET_MISMATCH'
  | 'TARGET_AMBIGUOUS'
  | 'TOKEN_EXPIRED'
  | 'TRIGGER_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'STORE_CORRUPTED'
  | 'UNKNOWN';

export interface PowerAutomateErrorPayload {
  blockedByUserAction?: boolean;
  code: PowerAutomateErrorCode;
  details?: unknown;
  message: string;
  retryable: boolean;
}

export class PowerAutomateError extends Error {
  blockedByUserAction: boolean;
  code: PowerAutomateErrorCode;
  details?: unknown;
  retryable: boolean;

  constructor({
    blockedByUserAction = false,
    code,
    details,
    message,
    retryable = false,
  }: {
    blockedByUserAction?: boolean;
    code: PowerAutomateErrorCode;
    details?: unknown;
    message: string;
    retryable?: boolean;
  }) {
    super(message);
    this.name = 'PowerAutomateError';
    this.blockedByUserAction = blockedByUserAction;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export class PowerAutomateSessionError extends PowerAutomateError {
  constructor({
    blockedByUserAction,
    code = 'NO_SESSION',
    details,
    message,
    retryable = true,
  }: {
    blockedByUserAction?: boolean;
    code?: PowerAutomateErrorCode;
    details?: unknown;
    message: string;
    retryable?: boolean;
  }) {
    super({ blockedByUserAction, code, details, message, retryable });
    this.name = 'PowerAutomateSessionError';
  }
}

const getObjectValue = (value: unknown, key: string) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

const toText = (value: unknown) => (typeof value === 'string' ? value : null);

const parseRejectedMember = (message: string) => {
  const match = message.match(/member\s+'([^']+)'/i) || message.match(/property\s+'([^']+)'/i);
  return match?.[1] || null;
};

const parsePowerAutomateBody = (body: unknown) => {
  const error = getObjectValue(body, 'error');
  const code = toText(getObjectValue(error, 'code')) || toText(getObjectValue(body, 'code'));
  const message =
    toText(getObjectValue(error, 'message')) ||
    toText(getObjectValue(body, 'message')) ||
    (typeof body === 'string' ? body : '');

  return {
    code,
    message,
  };
};

export const toPowerAutomateApiError = ({
  body,
  fallbackMessage,
  status,
  statusText,
}: {
  body: unknown;
  fallbackMessage: string;
  status: number;
  statusText: string;
}) => {
  const parsed = parsePowerAutomateBody(body);
  const message = parsed.message || fallbackMessage || `Power Automate API request failed with ${status} ${statusText}.`;
  const lowerMessage = message.toLowerCase();
  const lowerCode = (parsed.code || '').toLowerCase();

  if (status === 401 || status === 403 || lowerCode === 'authenticationfailed') {
    return new PowerAutomateSessionError({
      code: lowerCode === 'authenticationfailed' ? 'AUTHENTICATION_FAILED' : 'SESSION_EXPIRED',
      details: {
        providerCode: parsed.code || null,
        status,
      },
      message:
        lowerCode === 'authenticationfailed'
          ? 'Power Automate rejected the captured token for this endpoint. Capture a fresh browser session before retrying.'
          : 'The captured Power Automate session is expired or invalid. Reopen or refresh the flow in the browser to capture a fresh token.',
      retryable: true,
    });
  }

  if (lowerCode === 'connectionauthorizationfailed' || lowerMessage.includes('connectionauthorizationfailed')) {
    return new PowerAutomateError({
      blockedByUserAction: true,
      code: 'CONNECTION_AUTHORIZATION_FAILED',
      details: {
        providerCode: parsed.code || null,
        status,
      },
      message,
      retryable: false,
    });
  }

  if (/could not find member|member\s+'[^']+'|unexpected property/i.test(message)) {
    return new PowerAutomateError({
      code: 'SCHEMA_VALIDATION_FAILED',
      details: {
        member: parseRejectedMember(message),
        providerCode: parsed.code || null,
        status,
      },
      message,
      retryable: false,
    });
  }

  return new PowerAutomateError({
    code: 'UNKNOWN',
    details: {
      providerCode: parsed.code || null,
      status,
    },
    message,
    retryable: false,
  });
};

export const toErrorPayload = (error: unknown): PowerAutomateErrorPayload => {
  if (error instanceof PowerAutomateError) {
    return {
      blockedByUserAction: error.blockedByUserAction,
      code: error.code,
      details: error.details,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: 'UNKNOWN',
    details: undefined,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
};
