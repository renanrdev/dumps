// test/paste.test.ts — Unit tests for domain/paste.ts helpers.

import { describe, it, expect } from "vitest";
import { parseTTL, parseRedactMode, detectLang, DEFAULT_TTL } from "../src/domain/paste.js";

describe("parseTTL", () => {
  it("returns DEFAULT_TTL for null", () => {
    expect(parseTTL(null)).toBe(DEFAULT_TTL);
  });

  it("returns DEFAULT_TTL for empty string", () => {
    expect(parseTTL("")).toBe(DEFAULT_TTL);
  });

  it("returns each valid TTL value", () => {
    expect(parseTTL("10m")).toBe("10m");
    expect(parseTTL("1h")).toBe("1h");
    expect(parseTTL("1d")).toBe("1d");
    expect(parseTTL("7d")).toBe("7d");
    expect(parseTTL("30d")).toBe("30d");
  });

  it("returns DEFAULT_TTL for unrecognized values", () => {
    expect(parseTTL("2h")).toBe(DEFAULT_TTL);
    expect(parseTTL("forever")).toBe(DEFAULT_TTL);
    expect(parseTTL("1D")).toBe(DEFAULT_TTL); // case-sensitive
    expect(parseTTL("0")).toBe(DEFAULT_TTL);
  });
});

describe("parseRedactMode", () => {
  it("returns mask for null", () => {
    expect(parseRedactMode(null)).toBe("mask");
  });

  it("returns mask for empty string", () => {
    expect(parseRedactMode("")).toBe("mask");
  });

  it("returns each valid mode", () => {
    expect(parseRedactMode("warn")).toBe("warn");
    expect(parseRedactMode("mask")).toBe("mask");
    expect(parseRedactMode("block")).toBe("block");
  });

  it("returns mask for invalid values", () => {
    expect(parseRedactMode("MASK")).toBe("mask"); // case-sensitive
    expect(parseRedactMode("redact")).toBe("mask");
    expect(parseRedactMode("none")).toBe("mask");
  });
});

describe("detectLang", () => {
  it("returns lowercased hint when provided", () => {
    expect(detectLang("anything", "YAML")).toBe("yaml");
    expect(detectLang("{}", "JSON")).toBe("json");
    expect(detectLang("", "Dockerfile")).toBe("dockerfile");
  });

  it("truncates hint to 20 chars", () => {
    const long = "averylonglanguagename_extra";
    expect(detectLang("x", long).length).toBe(20);
  });

  it("strips CRLF from hint to prevent HTTP header injection", () => {
    const evil = "yaml\r\nX-Evil: injected";
    const result = detectLang("x", evil);
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });

  it("strips other control characters from hint", () => {
    const withControl = "yaml\x00\x01\x1f";
    const result = detectLang("x", withControl);
    expect(result).toMatch(/^[^\x00-\x1f\x7f]+$/);
  });

  it("detects json from { prefix", () => {
    expect(detectLang('{"key": "value"}')).toBe("json");
    expect(detectLang('[1, 2, 3]')).toBe("json");
  });

  it("detects yaml from --- prefix", () => {
    expect(detectLang("---\nkey: value\n")).toBe("yaml");
  });

  it("detects yaml from key: value pattern", () => {
    expect(detectLang("apiVersion: apps/v1\nkind: Deployment")).toBe("yaml");
  });

  it("detects hcl from resource block", () => {
    expect(detectLang('resource "aws_s3_bucket" "main" {')).toBe("hcl");
  });

  it("detects hcl from terraform block", () => {
    expect(detectLang("terraform {\n  required_version = \">= 1.0\"\n}")).toBe("hcl");
  });

  it("detects pem from -----BEGIN prefix", () => {
    expect(detectLang("-----BEGIN RSA PRIVATE KEY-----")).toBe("pem");
    expect(detectLang("-----BEGIN CERTIFICATE-----")).toBe("pem");
  });

  it("detects diff from diff --git prefix", () => {
    expect(detectLang("diff --git a/file.ts b/file.ts")).toBe("diff");
  });

  it("detects diff from @@ hunk header", () => {
    expect(detectLang("@@ -1,5 +1,7 @@")).toBe("diff");
  });

  it("detects shell from $ prefix", () => {
    expect(detectLang("$ kubectl get pods")).toBe("shell");
  });

  it("detects shell from shebang", () => {
    expect(detectLang("#!/bin/bash\necho hello")).toBe("shell");
  });

  it("detects log from Error prefix", () => {
    expect(detectLang("Error: connection refused")).toBe("log");
  });

  it("detects log from Traceback prefix", () => {
    expect(detectLang("Traceback (most recent call last):")).toBe("log");
  });

  it("detects log from panic prefix", () => {
    expect(detectLang("panic: runtime error: index out of range")).toBe("log");
  });

  it("detects log from timestamp prefix", () => {
    expect(detectLang("2024-01-15 INFO service started")).toBe("log");
    expect(detectLang("[2024-01-15] ERROR")).toBe("log");
  });

  it("detects kubectl from Name/Namespace prefix", () => {
    expect(detectLang("Name:         my-pod\nNamespace:    default")).toBe("kubectl");
  });

  it("returns text for unrecognized content", () => {
    expect(detectLang("hello world")).toBe("text");
    expect(detectLang("just some plain text without patterns")).toBe("text");
  });
});
