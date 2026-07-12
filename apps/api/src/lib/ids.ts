import { createHmac, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

export function generateId(): string {
  return uuidv7();
}

export function generateToken(size = 32): string {
  return randomBytes(size).toString("base64url");
}

export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}
