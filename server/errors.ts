export type PowerAutomateErrorCode =
  | 'NO_SESSION'
  | 'NO_TARGET'
  | 'FLOW_NOT_FOUND'
  | 'LEGACY_TOKEN_MISSING'
  | 'SESSION_EXPIRED'
  | 'TARGET_MISMATCH'
  | 'TRIGGER_NOT_FOUND'
  | 'CALLBACK_URL_MISSING'
  | 'INVALID_REQUEST'
  | 'STORE_CORRUPTED'
  | 'BAP_TOKEN_MISSING'
  | 'DATAVERSE_TOKEN_MISSING'
  | 'DATAVERSE_INSTANCE_NOT_FOUND'
  | 'PUBLISHER_NOT_FOUND'
  | 'SOLUTION_NOT_FOUND'
  | 'ENV_VAR_NOT_FOUND'
  | 'INVALID_UNIQUE_NAME'
  | 'UNKNOWN';

export interface PowerAutomateErrorPayload {
  code: PowerAutomateErrorCode;
  details?: unknown;
  message: string;
  retryable: boolean;
}

export class PowerAutomateError extends Error {
  code: PowerAutomateErrorCode;
  details?: unknown;
  retryable: boolean;

  constructor({
    code,
    details,
    message,
    retryable = false,
  }: {
    code: PowerAutomateErrorCode;
    details?: unknown;
    message: string;
    retryable?: boolean;
  }) {
    super(message);
    this.name = 'PowerAutomateError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export class PowerAutomateSessionError extends PowerAutomateError {
  constructor({
    code = 'NO_SESSION',
    details,
    message,
    retryable = true,
  }: {
    code?: PowerAutomateErrorCode;
    details?: unknown;
    message: string;
    retryable?: boolean;
  }) {
    super({ code, details, message, retryable });
    this.name = 'PowerAutomateSessionError';
  }
}

export const toErrorPayload = (error: unknown): PowerAutomateErrorPayload => {
  if (error instanceof PowerAutomateError) {
    return {
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
