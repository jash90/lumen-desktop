/**
 * Error model (PRD §32).
 *
 * The renderer must never see ECONNREFUSED or a TLS alert — every failure is
 * narrowed to one of these codes plus a message a user can act on.
 */

export type AppErrorCode =
  | 'BridgeNotFound'
  | 'BridgeOffline'
  | 'PairingRequired'
  | 'PairingTimeout'
  | 'Unauthorized'
  | 'RequestFailed'
  | 'UnsupportedCapability'
  | 'NetworkError'
  | 'CertificateError'
  | 'ResourceUnavailable'
  | 'StorageUnavailable';

/** Plain object shape — Error subclasses do not survive Electron's IPC structured clone. */
export interface SerializedAppError {
  code: AppErrorCode;
  message: string;
}

/*
 * Codes only the Hue adapter can raise still name the bridge — the link-button
 * ceremony and the pinned certificate are facts about that hardware. The rest
 * say "hub", because any provider can produce them.
 */
const USER_MESSAGES: Record<AppErrorCode, string> = {
  BridgeNotFound: 'No Hue Bridge found on the network.',
  BridgeOffline: 'Could not connect to the hub.',
  PairingRequired: 'Press the button on the Hue Bridge to connect this app.',
  PairingTimeout: 'The button on the Hue Bridge was not pressed in time.',
  Unauthorized: 'This app lost access to the hub. Connect it again.',
  RequestFailed: 'The hub rejected the request.',
  UnsupportedCapability: 'This light does not support that feature.',
  NetworkError: 'Network problem. Check the connection to your home Wi-Fi.',
  CertificateError:
    'Could not verify the identity of the Hue Bridge. The connection was aborted.',
  ResourceUnavailable: 'That light is not available — its hub is not connected.',
  StorageUnavailable:
    'This system provides no secure password storage. The credentials were not saved.',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Message safe to render in the UI. `message` keeps the technical detail for logs. */
  readonly userMessage: string;

  constructor(code: AppErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }

  toJSON(): SerializedAppError {
    return { code: this.code, message: this.userMessage };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Last line of defence: anything that escapes a handler still reaches the UI as a
 * typed error rather than a raw Node error string.
 */
export function toSerializedError(value: unknown): SerializedAppError {
  if (isAppError(value)) return value.toJSON();
  return { code: 'RequestFailed', message: USER_MESSAGES.RequestFailed };
}

export function userMessageFor(code: AppErrorCode): string {
  return USER_MESSAGES[code];
}
