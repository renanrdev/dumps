// test/cli_args.test.ts — Unit tests for the CLI argument parser
// (packages/cli/src/args.ts). Pure functions, no I/O.

import { describe, it, expect } from "vitest";
import { parseArgs, extractFlag, UsageError } from "../packages/cli/src/args.js";

// parseArgs strips argv[0] (node) and argv[1] (script path); these helpers
// build a realistic argv so the tests exercise the same slice the CLI does.
const argv = (...args: string[]): string[] => ["node", "dumps", ...args];

describe("extractFlag", () => {
  it("reads the --flag=value form", () => {
    expect(extractFlag(["--ttl=1h"], "--ttl")).toBe("1h");
  });

  it("reads the --flag value form", () => {
    expect(extractFlag(["--ttl", "1h"], "--ttl")).toBe("1h");
  });

  it("returns null when the flag is absent", () => {
    expect(extractFlag(["--burn"], "--ttl")).toBeNull();
  });

  it("does not consume the next token when it looks like another flag", () => {
    // "--ttl --burn" must not treat "--burn" as the ttl value.
    expect(extractFlag(["--ttl", "--burn"], "--ttl")).toBeNull();
  });

  it("returns an empty string for --flag= (explicit empty value)", () => {
    expect(extractFlag(["--ttl="], "--ttl")).toBe("");
  });
});

describe("parseArgs — defaults & upload", () => {
  it("defaults to upload with no args", () => {
    expect(parseArgs(argv())).toEqual({ command: "upload" });
  });

  it("treats bare flags as an upload", () => {
    const parsed = parseArgs(argv("--ttl=1h", "--burn", "--lang=yaml"));
    expect(parsed).toMatchObject({
      command: "upload",
      ttl: "1h",
      burn: true,
      lang: "yaml",
    });
  });

  it("accepts every valid ttl value", () => {
    for (const ttl of ["10m", "1h", "1d", "7d", "30d"]) {
      expect(parseArgs(argv(`--ttl=${ttl}`)).ttl).toBe(ttl);
    }
  });

  it("rejects an invalid ttl", () => {
    expect(() => parseArgs(argv("--ttl=2h"))).toThrow(UsageError);
    expect(() => parseArgs(argv("--ttl=2h"))).toThrow(/Invalid --ttl/);
  });

  it("accepts every valid redact mode", () => {
    for (const mode of ["warn", "mask", "block"]) {
      expect(parseArgs(argv(`--redact=${mode}`)).redact).toBe(mode);
    }
  });

  it("rejects an invalid redact mode", () => {
    expect(() => parseArgs(argv("--redact=nuke"))).toThrow(/Invalid --redact/);
  });

  it("sets burn from the bare --burn flag", () => {
    expect(parseArgs(argv("--burn")).burn).toBe(true);
    expect(parseArgs(argv()).burn).toBeUndefined();
  });
});

describe("parseArgs — get", () => {
  it("parses get <id>", () => {
    expect(parseArgs(argv("get", "abc123"))).toEqual({ command: "get", pasteId: "abc123" });
  });

  it("accepts the fetch alias", () => {
    expect(parseArgs(argv("fetch", "abc123")).command).toBe("get");
  });

  it("throws when the id is missing", () => {
    expect(() => parseArgs(argv("get"))).toThrow(UsageError);
  });
});

describe("parseArgs — delete", () => {
  it("parses delete <id>", () => {
    expect(parseArgs(argv("delete", "abc123"))).toEqual({ command: "delete", pasteId: "abc123" });
  });

  it("accepts the rm alias", () => {
    expect(parseArgs(argv("rm", "abc123")).command).toBe("delete");
  });

  it("captures an explicit --token", () => {
    const parsed = parseArgs(argv("delete", "abc123", "--token=del_xyz"));
    expect(parsed).toMatchObject({ command: "delete", pasteId: "abc123", token: "del_xyz" });
  });

  it("omits token when not provided", () => {
    expect(parseArgs(argv("delete", "abc123")).token).toBeUndefined();
  });

  it("throws when the id is missing", () => {
    expect(() => parseArgs(argv("delete"))).toThrow(UsageError);
  });
});

describe("parseArgs — config", () => {
  it("parses config set <key> <value>", () => {
    const parsed = parseArgs(argv("config", "set", "url", "https://x.example.com"));
    expect(parsed).toEqual({
      command: "config",
      configAction: "set",
      configKey: "url",
      configValue: "https://x.example.com",
    });
  });

  it("parses config get <key>", () => {
    expect(parseArgs(argv("config", "get", "url"))).toEqual({
      command: "config",
      configAction: "get",
      configKey: "url",
    });
  });

  it("throws on an unknown action", () => {
    expect(() => parseArgs(argv("config", "wat", "url"))).toThrow(UsageError);
  });

  it("throws when set has no value", () => {
    expect(() => parseArgs(argv("config", "set", "url"))).toThrow(UsageError);
  });

  it("throws when the key is missing", () => {
    expect(() => parseArgs(argv("config", "set"))).toThrow(UsageError);
  });
});

describe("parseArgs — help & version", () => {
  it("maps help aliases", () => {
    for (const a of ["help", "--help", "-h"]) {
      expect(parseArgs(argv(a)).command).toBe("help");
    }
  });

  it("maps version aliases", () => {
    for (const a of ["version", "--version", "-v"]) {
      expect(parseArgs(argv(a)).command).toBe("version");
    }
  });
});
