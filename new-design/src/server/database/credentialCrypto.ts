import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function deriveModelCredentialKey(password: string, database: string): Buffer {
  if (!password || !database) throw new Error("新版数据库凭据加密材料不可用。");
  return scryptSync(password, `ai-novel:new-design:credentials:v1:${database}`, 32);
}

export function sealModelCredential(secret: string, key: Buffer): Buffer {
  if (!secret || Buffer.byteLength(secret, "utf8") > 8192 || key.length !== 32) throw new Error("模型密钥格式无效。");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, cipher.getAuthTag(), encrypted]);
}

export function openModelCredential(envelope: Buffer, key: Buffer): string {
  if (!Buffer.isBuffer(envelope) || envelope.length <= 1 + IV_BYTES + TAG_BYTES || envelope[0] !== ENVELOPE_VERSION || key.length !== 32) throw new Error("模型密钥密文无效。");
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
