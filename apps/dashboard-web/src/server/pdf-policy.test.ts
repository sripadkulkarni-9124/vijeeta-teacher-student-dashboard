import { describe, expect, it } from "vitest";

import { canDownloadPdf } from "./pdf-policy";

describe("PDF download policy", () => {
  it("grants download to admins and verified Vedantu addresses", () => {
    expect(canDownloadPdf({ uid: "u1", admin: true })).toBe(true);
    expect(canDownloadPdf({ uid: "u2", email: "meera@vedantu.com", emailVerified: true })).toBe(true);
    expect(canDownloadPdf({ uid: "u3", email: "  Meera@Vedantu.com ", emailVerified: true })).toBe(true);
  });

  it("fails closed for unverified, non-Vedantu, or missing claims", () => {
    expect(canDownloadPdf({ uid: "u4" })).toBe(false);
    expect(canDownloadPdf({ uid: "u5", email: "meera@vedantu.com" })).toBe(false);
    expect(canDownloadPdf({ uid: "u6", email: "meera@vedantu.com", emailVerified: false })).toBe(false);
    expect(canDownloadPdf({ uid: "u7", email: "meera@example.com", emailVerified: true })).toBe(false);
    expect(canDownloadPdf({ uid: "u8", email: "@vedantu.com", emailVerified: true })).toBe(false);
    expect(canDownloadPdf({ uid: "u9", email: "attacker@evil.test@vedantu.com", emailVerified: true })).toBe(false);
    expect(canDownloadPdf({ uid: "u10", email: "meera@vedantu.com.evil.test", emailVerified: true })).toBe(false);
    expect(canDownloadPdf({ uid: "u11", email: null, emailVerified: true })).toBe(false);
  });
});
