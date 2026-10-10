/**
 * Error model (PRD §32).
 *
 * The renderer must never see ECONNREFUSED or a TLS alert — every failure is
 * narrowed to one of these codes plus a message a user can act on.
 */

import { t } from './i18n';

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
  | 'StorageUnavailable'
  | 'CloudUnauthorized'
  | 'CloudPermission';

/** Plain object shape — Error subclasses do not survive Electron's IPC structured clone. */
export interface SerializedAppError {
  code: AppErrorCode;
  message: string;
}

/*
 * Codes only the Hue adapter can raise still name the bridge — the link-button
 * ceremony and the pinned certificate are facts about that hardware. The rest
 * say "hub", because any provider can produce them. The texts live in the
 * i18n dictionaries under `error.<code>`, in the language of the main process.
 */
const userMessage = (code: AppErrorCode): string => t(`error.${code}`);

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Message safe to render in the UI. `message` keeps the technical detail for logs. */
  readonly userMessage: string;

  constructor(code: AppErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage(code);
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
  return { code: 'RequestFailed', message: userMessage('RequestFailed') };
}

export function userMessageFor(code: AppErrorCode): string {
  return userMessage(code);
}
