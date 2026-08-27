import { describe, expect, it } from "vitest";
import { VerifiedPrincipalSchema as SharedVerifiedPrincipalSchema } from "@vijeeta/api-contracts";

import { VerifiedPrincipalSchema } from "./principal";

const authTime = "2026-08-28T00:00:00.000Z";

describe("VerifiedPrincipalSchema", () => {
  it("reuses the canonical shared principal schema", () => {
    expect(VerifiedPrincipalSchema).toBe(SharedVerifiedPrincipalSchema);
  });

  it("keeps authentication metadata in the canonical authorization-free principal", () => {
    expect(VerifiedPrincipalSchema.parse({
      uid: "firebase-user-1",
      email: "teacher@example.com",
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
});
