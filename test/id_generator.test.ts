// test/id_generator.test.ts — Unit tests for the ID and token generator.

import { describe, it, expect } from "vitest";
import {
  generateId,
  generateDeletionToken,
  verifyDeletionToken,
} from "../src/domain/id_generator.js";

describe("generateId", () => {
  it("produces a string of length 10 by default", () => {
    const id = generateId();
    expect(id).toHaveLength(10);
  });

  it("uses only base62 characters", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it("respects custom length", () => {
    for (const len of [5, 8, 12, 20]) {
      expect(generateId(len)).toHaveLength(len);
    }
  });
});

describe("generateDeletionToken", () => {
  it("token starts with del_", async () => {
    const { token } = await generateDeletionToken();
    expect(token).toMatch(/^del_/);
  });

  it("hash starts with sha256:", async () => {
    const { hash } = await generateDeletionToken();
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("token and hash differ", async () => {
    const { token, hash } = await generateDeletionToken();
    expect(token).not.toBe(hash);
  });
});

describe("verifyDeletionToken", () => {
  it("returns true for correct token", async () => {
    const { token, hash } = await generateDeletionToken();
    expect(await verifyDeletionToken(token, hash)).toBe(true);
  });

  it("returns false for wrong token", async () => {
    const { hash } = await generateDeletionToken();
    expect(await verifyDeletionToken("del_wrong_token", hash)).toBe(false);
  });

  it("returns false for malformed hash", async () => {
    const { token } = await generateDeletionToken();
    expect(await verifyDeletionToken(token, "not-a-hash")).toBe(false);
  });

  it("returns false for empty token", async () => {
    const { hash } = await generateDeletionToken();
    expect(await verifyDeletionToken("", hash)).toBe(false);
  });
});
