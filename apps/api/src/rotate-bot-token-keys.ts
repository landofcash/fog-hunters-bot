import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./lib/config";
import {
  decryptBotToken,
  encryptBotToken,
} from "./modules/bots/bot-token-crypto";

const BATCH_SIZE = 100;

function toBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const activeVersion = config.botTokenActiveKeyVersion;
  const activeKey = config.botTokenEncryptionKeys.get(activeVersion);
  if (!activeKey) {
    throw new Error(`BOT_TOKEN_ENCRYPTION_KEY_V${activeVersion} is unavailable.`);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });

  let rotated = 0;
  try {
    for (;;) {
      const rows = await prisma.botTokenSecret.findMany({
        where: { encryptionKeyVersion: { not: activeVersion } },
        include: {
          botInstance: {
            select: { discordApplicationId: true },
          },
        },
        orderBy: { botInstanceId: "asc" },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        const previousKey = config.botTokenEncryptionKeys.get(
          row.encryptionKeyVersion,
        );
        if (!previousKey) {
          throw new Error(
            `BOT_TOKEN_ENCRYPTION_KEY_V${row.encryptionKeyVersion} is required to rotate bot ${row.botInstanceId}.`,
          );
        }
        const plaintext = decryptBotToken({
          encrypted: {
            ciphertext: Buffer.from(row.ciphertext),
            nonce: Buffer.from(row.nonce),
            authenticationTag: Buffer.from(row.authenticationTag),
            encryptionKeyVersion: row.encryptionKeyVersion,
          },
          key: previousKey,
          botInstanceId: row.botInstanceId,
          discordApplicationId: row.botInstance.discordApplicationId,
        });
        const encrypted = encryptBotToken({
          token: plaintext,
          key: activeKey,
          keyVersion: activeVersion,
          botInstanceId: row.botInstanceId,
          discordApplicationId: row.botInstance.discordApplicationId,
        });

        const result = await prisma.botTokenSecret.updateMany({
          where: {
            botInstanceId: row.botInstanceId,
            encryptionKeyVersion: row.encryptionKeyVersion,
          },
          data: {
            ciphertext: toBytes(encrypted.ciphertext),
            nonce: toBytes(encrypted.nonce),
            authenticationTag: toBytes(encrypted.authenticationTag),
            encryptionKeyVersion: activeVersion,
          },
        });
        rotated += result.count;
      }
    }

    console.log(`Bot-token key rotation complete. Re-encrypted ${rotated} token(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
