import { describe, expect, it } from "vitest";

import { VerifiedPrincipalSchema } from "./principal";

const authTime = "2026-08-28T00:00:00.000Z";

describe("VerifiedPrincipalSchema", () => {
  it("normalizes the verified Firebase identity and keeps authorization claims out", () => {
    expect(VerifiedPrincipalSchema.parse({
      uid: "firebase-user-1",
      email: " Teacher@Example.COM ",
      emailVerified: true,
      displayName: "Teacher One",
      authTime,
    })).toEqual({
      uid: "firebase-user-1",
      email: "teacher@example.com",
      emailVerified: true,
      displayName: "Teacher One",
      authTime,
    });

    expect(() => VerifiedPrincipalSchema.parse({
      uid: "firebase-user-1",
      email: "teacher@example.com",
      emailVerified: true,
      displayName: "Teacher One",
      authTime,
      roles: { admin: "active" },
    })).toThrow();
  });

  it("rejects malformed Firebase identity and authentication metadata", () => {
    const principal = {
      uid: "firebase-user-1",
      email: "teacher@example.com",
      emailVerified: true,
      displayName: null,
      authTime,
    };

    expect(() => VerifiedPrincipalSchema.parse({ ...principal, uid: " " })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, email: "not-an-email" })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, email: null })).toThrow();
    expect(() => VerifiedPrincipalSchema.parse({ ...principal, authTime: "not-a-time" })).toThrow();
  });
});
