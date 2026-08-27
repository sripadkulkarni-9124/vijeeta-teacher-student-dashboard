import { describe, expect, it } from "vitest";
import { redactHeaders, sanitizeError } from "./redaction";

describe("BFF redaction", () => {
  it("removes credentials and cookies from log-safe headers/errors", () => {
    expect(redactHeaders({ authorization: "Bearer secret", cookie: "sid=secret", "x-admin-key": "admin" })).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-admin-key": "[REDACTED]",
    });
    expect(sanitizeError(new Error("Bearer secret cookie=sid=secret"))).not.toContain("secret");
  });
});
