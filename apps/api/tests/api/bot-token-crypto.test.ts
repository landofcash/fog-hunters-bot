import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isApiError } from "../../src/lib/errors";
import {
  buildBotTokenAdditionalData,
  decryptBotToken,
  encryptBotToken,
  hashOpaqueToken,
  safeHashEquals,
} from "../../src/modules/bots/bot-token-crypto";

describe("bot token encryption", () => {
  it("round-trips AES-256-GCM ciphertext with identity-bound AAD", () => {
    const key = randomBytes(32);
    const encrypted = encryptBotToken({
      token: "discord-secret-token",
      key,
      keyVersion: 7,
      botInstanceId: "bot-a",
      discordApplicationId: "application-a",
    });

    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.authenticationTag).toHaveLength(16);
    expect(
      decryptBotToken({
        encrypted,
        key,
        botInstanceId: "bot-a",
        discordApplicationId: "application-a",
      }),
    ).toBe("discord-secret-token");
  });

  it.each([
    ["wrong key", { key: randomBytes(32) }],
    ["wrong bot", { botInstanceId: "bot-b" }],
    ["wrong application", { discordApplicationId: "application-b" }],
  ])("rejects tampering through %s", (_label, patch) => {
    const key = randomBytes(32);
    const encrypted = encryptBotToken({
      token: "discord-secret-token",
      key,
      keyVersion: 1,
      botInstanceId: "bot-a",
      discordApplicationId: "application-a",
    });

    try {
      decryptBotToken({
        encrypted,
        key,
        botInstanceId: "bot-a",
        discordApplicationId: "application-a",
        ...patch,
      });
      throw new Error("Expected decryption to fail.");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.code).toBe("BOT_TOKEN_DECRYPT_FAILED");
    }
  });

  it("uses an unambiguous, versioned AAD encoding", () => {
    const first = buildBotTokenAdditionalData({
      botInstanceId: "ab",
      discordApplicationId: "c",
      keyVersion: 1,
    });
    const second = buildBotTokenAdditionalData({
      botInstanceId: "a",
      discordApplicationId: "bc",
      keyVersion: 1,
    });

    expect(first.equals(second)).toBe(false);
    expect(first[0]).toBe(1);
  });

  it("hashes and constant-time compares opaque lease credentials", () => {
    const hash = hashOpaqueToken("lease-token");
    expect(hash).toHaveLength(64);
    expect(safeHashEquals(hash, hashOpaqueToken("lease-token"))).toBe(true);
    expect(safeHashEquals(hash, hashOpaqueToken("other-token"))).toBe(false);
  });
});
