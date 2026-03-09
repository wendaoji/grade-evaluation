import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}:${salt}:${hash}`;
}

export function isPasswordHashed(value) {
  return typeof value === "string" && value.startsWith(`${HASH_PREFIX}:`);
}

export function verifyPassword(password, storedValue) {
  if (!isPasswordHashed(storedValue)) {
    return password === storedValue;
  }

  const [, salt, hash] = storedValue.split(":");
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
