import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, isPasswordHashed, verifyPassword } from "../src/security.js";

test("hashPassword returns scrypt value and verifyPassword validates it", () => {
  const hashed = hashPassword("admin123");
  assert.equal(isPasswordHashed(hashed), true);
  assert.equal(verifyPassword("admin123", hashed), true);
  assert.equal(verifyPassword("wrong", hashed), false);
});
