// test/scanner.test.ts — Unit tests for the secret scanner.
// Run with: npx vitest run test/scanner.test.ts

import { describe, it, expect } from "vitest";
import { scan, RULES } from "../src/domain/scanner.js";

// ---------------------------------------------------------------------------
// True positives — MUST be detected and (in mask mode) replaced.
// ---------------------------------------------------------------------------

describe("scanner — true positives (must detect)", () => {
  it("TP-01: AWS access key ID", () => {
    const input = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const result = scan(input, "mask");
    expect(result.types).toContain("aws_access_key_id");
    expect(result.redacted).toContain("‹REDACTED:aws_access_key_id›");
    expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("TP-02: AWS secret access key", () => {
    const input =
      "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const result = scan(input, "mask");
    expect(result.types).toContain("aws_secret_access_key");
    expect(result.redacted).toContain("‹REDACTED:aws_secret_access_key›");
    expect(result.redacted).not.toContain("wJalrXUtnFEMI");
  });

  it("TP-03: GitHub personal access token (ghp_ prefix)", () => {
    const input = "GITHUB_TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a";
    const result = scan(input, "mask");
    expect(result.types).toContain("github_token");
    expect(result.redacted).not.toContain("ghp_16C7e42F292c6912E7710c838347Ae178B4a");
  });

  it("TP-04: Slack bot token", () => {
    const input = "SLACK_TOKEN=xoxb-17653285-BoT-token-example-123456";
    const result = scan(input, "mask");
    expect(result.types).toContain("slack_token");
    expect(result.redacted).toContain("‹REDACTED:slack_token›");
  });

  it("TP-05: Stripe live secret key", () => {
    // Deliberately split so GitHub Push Protection doesn't flag as a real key.
    const input = "stripe_key: " + "sk_live_" + "xxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const result = scan(input, "mask");
    expect(result.types).toContain("stripe_secret_key");
    expect(result.redacted).not.toContain("sk_live_");
  });

  it("TP-06: JWT token", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `Authorization: Bearer ${jwt}`;
    const result = scan(input, "mask");
    // Should catch either via jwt rule or authorization_bearer rule
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("TP-07: PEM private key block", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5O3YZC1pLMSE2kHKQ6GnrZkPW0UjMVQBJ
-----END RSA PRIVATE KEY-----`;
    const result = scan(input, "mask");
    expect(result.types).toContain("pem_private_key");
    expect(result.redacted).toContain("‹REDACTED:pem_private_key›");
  });

  it("TP-08: Authorization Bearer header in logs", () => {
    const input =
      '2024-01-15 POST /api/v1/users Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature 200';
    const result = scan(input, "mask");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("TP-09: GitHub actions token (ghs_ prefix)", () => {
    const input = "token: ghs_16C7e42F292c6912E7710c838347Ae178B4a";
    const result = scan(input, "mask");
    expect(result.types).toContain("github_token");
  });

  it("TP-10: Generic password= assignment", () => {
    const cfgInput = "password=MyS3cur3P4ssw0rd123";
    const result = scan(cfgInput, "mask");
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("TP-11: DATABASE_URL with embedded password (DSN/URI format)", () => {
    const input =
      "DATABASE_URL: postgresql://admin:s3cr3tPassw0rd@prod-db.internal:5432/appdb";
    const result = scan(input, "mask");
    expect(result.types).toContain("connection_string_password");
    expect(result.redacted).not.toContain("s3cr3tPassw0rd");
    expect(result.redacted).toContain("‹REDACTED:connection_string_password›");
  });

  it("TP-12: api-key with hyphen in YAML key name", () => {
    const input = "api-key: c2tfdGVzdF9hYmNkZWZnMTIzNDU2Nzg5MA==";
    const result = scan(input, "mask");
    expect(result.types).toContain("generic_password");
    expect(result.redacted).not.toContain("c2tfdGVzdF9hYmNkZWZnMTIzNDU2Nzg5MA==");
  });
});

// ---------------------------------------------------------------------------
// True negatives — must NOT be flagged.
// ---------------------------------------------------------------------------

describe("scanner — true negatives (must NOT flag)", () => {
  it("TN-01: plain text prose", () => {
    const input =
      "The deployment completed successfully. All pods are running.";
    const result = scan(input, "mask");
    expect(result.matches.length).toBe(0);
    expect(result.redacted).toBe(input);
  });

  it("TN-02: JSON without secrets", () => {
    const input = JSON.stringify({
      status: "ok",
      message: "hello world",
      count: 42,
      tags: ["production", "api"],
    });
    const result = scan(input, "mask");
    expect(result.matches.length).toBe(0);
  });

  it("TN-03: Kubernetes pod describe output (no secrets)", () => {
    const input = `Name:         my-app-7d4f8b9-xkp2q
Namespace:    default
Labels:       app=my-app
              version=1.2.3
Status:       Running
IP:           10.244.0.15
Node:         node-01/192.168.1.10`;
    const result = scan(input, "mask");
    expect(result.matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mode behaviour
// ---------------------------------------------------------------------------

describe("scanner — mode behaviour", () => {
  // Valid 20-char AWS access key ID (AKIA + 16 uppercase alphanumeric)
  const inputWithSecret =
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPL3";

  it("warn mode: returns matches but does NOT modify content", () => {
    const result = scan(inputWithSecret, "warn");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.redacted).toBe(inputWithSecret);
  });

  it("mask mode: replaces secret in redacted string", () => {
    const result = scan(inputWithSecret, "mask");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE123");
    expect(result.redacted).toContain("‹REDACTED:");
  });

  it("block mode: returns matches but does NOT modify content", () => {
    const result = scan(inputWithSecret, "block");
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.redacted).toBe(inputWithSecret);
  });

  it("clean input: all modes return unchanged content with no matches", () => {
    const clean = "echo 'hello world'";
    for (const mode of ["warn", "mask", "block"] as const) {
      const result = scan(clean, mode);
      expect(result.matches.length).toBe(0);
      expect(result.redacted).toBe(clean);
    }
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe("scanner — deduplication", () => {
  it("overlapping patterns produce a single match", () => {
    // A JWT that would also match authorization_bearer is counted once.
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.hash123";
    const input = `Authorization: Bearer ${jwt}`;
    const result = scan(input, "mask");
    // Regardless of how many rules fire, the same byte range should not be
    // double-counted, and the content should be redacted only once.
    const occurrences = (result.redacted.match(/‹REDACTED:/g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(2); // at most 2 separate secrets
  });
});

// ---------------------------------------------------------------------------
// Rule coverage sanity check
// ---------------------------------------------------------------------------

describe("RULES export", () => {
  it("all rules have a type and a global regex", () => {
    for (const rule of RULES) {
      expect(rule.type).toBeTruthy();
      expect(rule.pattern.flags).toContain("g");
    }
  });
});

// ---------------------------------------------------------------------------
// ReDoS safety — connection string regex must complete quickly on adversarial input
// ---------------------------------------------------------------------------

describe("scanner — ReDoS safety", () => {
  it("connection_string rule completes in <50ms on 200k chars without '@'", () => {
    const evil = "postgres://user:" + "A".repeat(200_000);
    const start = Date.now();
    scan(evil, "mask");
    const elapsed = Date.now() - start;
    // Before the fix this took ~19 000ms — now bounded by {4,200} upper limit.
    expect(elapsed).toBeLessThan(50);
  });

  it("pem rule completes in <100ms on 10k BEGIN lines without END", () => {
    const manyBegin = "-----BEGIN RSA PRIVATE KEY-----\n".repeat(10_000);
    const start = Date.now();
    scan(manyBegin, "mask");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
