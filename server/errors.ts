export type PowerAutomateErrorCode =
  | 'NO_SESSION'
  | 'NO_TARGET'
  | 'FLOW_NOT_FOUND'
  | 'LEGACY_TOKEN_MISSING'
  | 'NO_API_TOKEN'
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
  // Rollback succeeded after a multi-step operation failed mid-way: the
  // server-visible state is back to where it was before the operation, so
  // the caller can retry with the same input safely.
  | 'ROLLED_BACK'
  // A multi-step operation failed mid-way AND the rollback also failed,
  // so the server-visible state is inconsistent and requires manual
  // cleanup. The error's `details` carries enough info for a targeted
  // cleanup call (e.g. `details.orphanDefinitionId`).
  | 'PARTIAL_FAILURE'
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
