import {
  ASL_KEY_AGREEMENT,
  deriveAslMacKey,
  generateAslClientKeyPair,
  wipeKeyMaterial,
} from './aslEcdh';

export type AslHandshakeSuccess = {
  sessionId: string;
  /** Present when ECDH completed (`configSync` handshake). */
  configMacKey?: Uint8Array;
  serverPublicKey?: string;
  salt?: string;
  keyAgreement?: typeof ASL_KEY_AGREEMENT;
};

export type AslHandshakeErrorCode =
  | 'ERR_AUTH'
  | 'ERR_RATE_LIMITED'
  | 'ERR_INTERNAL'
  | 'ERR_HANDSHAKE';

function sdkError(
  message: string,
  code: AslHandshakeErrorCode,
  extra?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * POST /auth/asl-handshake.
 * When `withEcdh` is true, sends `clientPublicKey` and derives the config-sync MAC key.
 */
export async function performAslHandshake(input: {
  handshakeUrl: string;
  apiKey: string;
  withEcdh?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AslHandshakeSuccess> {
  const fetchFn = input.fetchImpl ?? fetch;
  const abortController = new AbortController();
  const timeoutMs = input.timeoutMs ?? 10_000;
  const abortId = setTimeout(() => abortController.abort(), timeoutMs);

  let privateKey: Uint8Array | undefined;

  try {
    const headers: Record<string, string> = {
      'X-API-Key': input.apiKey,
      // Always send a JSON object body. Browsers POST with null body otherwise,
      // and FF-EU's Optional(Object) schema rejects null as "Must be of type object".
      'Content-Type': 'application/json',
    };
    let body = '{}';

    if (input.withEcdh) {
      const pair = generateAslClientKeyPair();
      privateKey = pair.privateKey;
      body = JSON.stringify({ clientPublicKey: pair.publicKeyHex });
    }

    let res: Response;
    try {
      res = await fetchFn(input.handshakeUrl, {
        method: 'POST',
        headers,
        body,
        signal: abortController.signal,
      });
    } catch (cause) {
      throw sdkError(
        abortController.signal.aborted
          ? `ASL handshake timed out after ${timeoutMs}ms`
          : 'ASL handshake network failure',
        'ERR_INTERNAL',
        { cause },
      );
    }

    if (res.status === 401) {
      throw sdkError('Invalid API credentials configuration.', 'ERR_AUTH');
    }
    if (res.status === 429) {
      throw sdkError('Client ingestion limits exceeded.', 'ERR_RATE_LIMITED');
    }
    if (res.status === 400) {
      const errBody = await res.json().catch(() => ({}));
      throw sdkError(
        (errBody as { message?: string })?.message ||
          'ASL handshake rejected clientPublicKey.',
        'ERR_HANDSHAKE',
        { statusCode: 400 },
      );
    }
    if (!res.ok) {
      throw sdkError(
        `Handshake server infrastructure exception (${res.status})`,
        'ERR_INTERNAL',
        { statusCode: res.status },
      );
    }

    const handshakeData = await res.json().catch(() => {
      throw sdkError(
        'Handshake parsing error: response body is not JSON.',
        'ERR_INTERNAL',
      );
    });
    const data = (handshakeData?.data ?? handshakeData) as {
      sessionId?: string;
      serverPublicKey?: string;
      salt?: string;
      keyAgreement?: string;
    };
    const sessionId = data?.sessionId;

    if (typeof sessionId !== 'string' || !sessionId) {
      throw sdkError(
        'Handshake parsing error: Remote platform returned empty session token.',
        'ERR_INTERNAL',
      );
    }

    if (!input.withEcdh) {
      return { sessionId };
    }

    if (
      typeof data.serverPublicKey !== 'string' ||
      typeof data.salt !== 'string' ||
      !privateKey
    ) {
      throw sdkError(
        'ASL ECDH incomplete: serverPublicKey/salt missing from handshake response.',
        'ERR_HANDSHAKE',
      );
    }

    if (
      typeof data.keyAgreement === 'string' &&
      data.keyAgreement !== ASL_KEY_AGREEMENT
    ) {
      throw sdkError(
        `ASL ECDH unsupported key agreement: ${data.keyAgreement}`,
        'ERR_HANDSHAKE',
      );
    }

    const { configMacKey } = (() => {
      try {
        return deriveAslMacKey({
          privateKey,
          peerPublicKeyHex: data.serverPublicKey,
          saltHex: data.salt,
        });
      } catch (err) {
        throw sdkError(
          err instanceof Error
            ? err.message
            : 'ASL ECDH key derivation failed.',
          'ERR_HANDSHAKE',
        );
      }
    })();

    return {
      sessionId,
      configMacKey,
      serverPublicKey: data.serverPublicKey,
      salt: data.salt,
      keyAgreement: ASL_KEY_AGREEMENT,
    };
  } finally {
    wipeKeyMaterial(privateKey);
    clearTimeout(abortId);
  }
}
