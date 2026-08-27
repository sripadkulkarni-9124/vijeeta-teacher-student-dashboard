import { describe, expect, it, vi } from "vitest";

import { matchesAdminBootstrap, parseAdminBootstrap } from "./admin-bootstrap";

const authTime = "2026-08-28T00:00:00.000Z";
const principal = {
  uid: "firebase-u1",
  email: "admin@example.com",
  emailVerified: true,
  displayName: null,
  authTime,
};

describe("parseAdminBootstrap", () => {
  it("parses only the strict versioned bootstrap allowlist", () => {
    expect(parseAdminBootstrap(JSON.stringify({
      version: 1,
      verifiedEmails: ["admin@example.com"],
      firebaseUids: ["firebase-u1"],
    }))).toEqual({
      version: 1,
      verifiedEmails: ["admin@example.com"],
      firebaseUids: ["firebase-u1"],
    });
  });

  it("rejects duplicates, case variants, invalid identities, and unknown keys", () => {
    expect(() => parseAdminBootstrap("not-json")).toThrow(/bootstrap/i);
    expect(() => parseAdminBootstrap(JSON.stringify({ version: 1, verifiedEmails: ["admin@example.com", "admin@example.com"], firebaseUids: [] }))).toThrow(/bootstrap/i);
    expect(() => parseAdminBootstrap(JSON.stringify({ version: 1, verifiedEmails: ["admin@example.com", "ADMIN@EXAMPLE.COM"], firebaseUids: [] }))).toThrow(/bootstrap/i);
    expect(() => parseAdminBootstrap(JSON.stringify({ version: 1, verifiedEmails: ["not-an-email"], firebaseUids: [] }))).toThrow(/bootstrap/i);
    expect(() => parseAdminBootstrap(JSON.stringify({ version: 1, verifiedEmails: [], firebaseUids: [" "] }))).toThrow(/bootstrap/i);
    expect(() => parseAdminBootstrap(JSON.stringify({ version: 1, verifiedEmails: [], firebaseUids: [], admin: true }))).toThrow(/bootstrap/i);
  });

  it("does not log secret contents when parsing fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "synthetic-secret@example.test";

    expect(() => parseAdminBootstrap(secret)).toThrow(/bootstrap/i);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    error.mockRestore();
    warn.mockRestore();
  });
});

describe("matchesAdminBootstrap", () => {
  it("matches a normalized email only when Firebase verified the email", () => {
    const config = { version: 1 as const, verifiedEmails: ["admin@example.com"], firebaseUids: [] };

    expect(matchesAdminBootstrap({ ...principal, email: " ADMIN@EXAMPLE.COM " }, config)).toBe(true);
    expect(matchesAdminBootstrap({ ...principal, emailVerified: false }, config)).toBe(false);
    expect(matchesAdminBootstrap({ ...principal, email: null, emailVerified: false }, config)).toBe(false);
  });

  it("matches Firebase UIDs exactly without treating email verification as a UID requirement", () => {
    const config = { version: 1 as const, verifiedEmails: [], firebaseUids: ["firebase-u1"] };

    expect(matchesAdminBootstrap({ ...principal, emailVerified: false }, config)).toBe(true);
    expect(matchesAdminBootstrap({ ...principal, uid: "FIREBASE-U1" }, config)).toBe(false);
    expect(matchesAdminBootstrap({ ...principal, uid: "firebase-u1 " }, config)).toBe(false);
  });
});
