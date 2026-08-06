import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ApiError } from "../../lib/errors";

const AAD_FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function encodeField(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

export function buildBotTokenAdditionalData(input: {
  botInstanceId: string;
  discordApplicationId: string;
  keyVersion: number;
}): Buffer {
  const version = Buffer.from([AAD_FORMAT_VERSION]);
  const keyVersion = Buffer.allocUnsafe(4);
  keyVersion.writeUInt32BE(input.keyVersion, 0);
  return Buffer.concat([
    version,
    keyVersion,
    encodeField(input.botInstanceId),
    encodeField(input.discordApplicationId),
  ]);
}

export interface EncryptedBotToken {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
  encryptionKeyVersion: number;
}

export function encryptBotToken(input: {
  token: string;
  key: Buffer;
  keyVersion: number;
  botInstanceId: string;
  discordApplicationId: string;
}): EncryptedBotToken {
  if (input.key.length !== 32) {
    throw new Error("Bot-token encryption key must be exactly 32 bytes.");
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", input.key, nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(buildBotTokenAdditionalData(input));
  const ciphertext = Buffer.concat([
    cipher.update(input.token, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext,
    nonce,
    authenticationTag: cipher.getAuthTag(),
    encryptionKeyVersion: input.keyVersion,
  };
}

export function decryptBotToken(input: {
  encrypted: EncryptedBotToken;
  key: Buffer;
  botInstanceId: string;
  discordApplicationId: string;
}): string {
  try {
    if (input.key.length !== 32) {
      throw new Error("Invalid key length.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      input.key,
      input.encrypted.nonce,
      { authTagLength: AUTH_TAG_BYTES },
    );
    decipher.setAAD(buildBotTokenAdditionalData({
      botInstanceId: input.botInstanceId,
      discordApplicationId: input.discordApplicationId,
      keyVersion: input.encrypted.encryptionKeyVersion,
    }));
    decipher.setAuthTag(input.encrypted.authenticationTag);
    return Buffer.concat([
      decipher.update(input.encrypted.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError(
      409,
      "BOT_TOKEN_DECRYPT_FAILED",
      "The configured bot token could not be decrypted.",
    );
  }
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function safeHashEquals(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
