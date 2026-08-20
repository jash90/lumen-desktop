/**
 * Error model (PRD §32).
 *
 * The renderer must never see ECONNREFUSED or a TLS alert — every failure is
 * narrowed to one of these codes plus a message a user can act on.
 */

export type HueErrorCode =
  | 'BridgeNotFound'
  | 'BridgeOffline'
  | 'PairingRequired'
  | 'PairingTimeout'
  | 'Unauthorized'
  | 'RequestFailed'
  | 'UnsupportedCapability'
  | 'NetworkError'
  | 'CertificateError'
  | 'StorageUnavailable';

/** Plain object shape — Error subclasses do not survive Electron's IPC structured clone. */
export interface SerializedHueError {
  code: HueErrorCode;
  message: string;
}

const USER_MESSAGES: Record<HueErrorCode, string> = {
  BridgeNotFound: 'Nie znaleziono Hue Bridge w sieci.',
  BridgeOffline: 'Nie udało się połączyć z Hue Bridge.',
  PairingRequired: 'Naciśnij przycisk na Hue Bridge, aby połączyć aplikację.',
  PairingTimeout: 'Nie naciśnięto przycisku na Hue Bridge na czas.',
  Unauthorized: 'Aplikacja straciła dostęp do Hue Bridge. Sparuj ją ponownie.',
  RequestFailed: 'Hue Bridge odrzucił żądanie.',
  UnsupportedCapability: 'Ta lampa nie obsługuje tej funkcji.',
  NetworkError: 'Problem z siecią. Sprawdź połączenie z domową siecią Wi-Fi.',
  CertificateError:
    'Nie udało się zweryfikować tożsamości Hue Bridge. Połączenie zostało przerwane.',
  StorageUnavailable:
    'System nie udostępnia bezpiecznego magazynu haseł. Nie zapisano danych logowania.',
};

export class HueError extends Error {
  readonly code: HueErrorCode;
  /** Message safe to render in the UI. `message` keeps the technical detail for logs. */
  readonly userMessage: string;

  constructor(code: HueErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'HueError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }

  toJSON(): SerializedHueError {
    return { code: this.code, message: this.userMessage };
  }
}

export function isHueError(value: unknown): value is HueError {
  return value instanceof HueError;
}

/**
 * Last line of defence: anything that escapes a handler still reaches the UI as a
 * typed error rather than a raw Node error string.
 */
export function toSerializedError(value: unknown): SerializedHueError {
  if (isHueError(value)) return value.toJSON();
  return { code: 'RequestFailed', message: USER_MESSAGES.RequestFailed };
}

export function userMessageFor(code: HueErrorCode): string {
  return USER_MESSAGES[code];
}
