import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { InviteTokenService, buildInvitationAcceptanceUrl } from "./invite-token";

const NOW = new Date("2026-08-28T10:00:00.000Z");
const EXPIRES_AT = "2026-09-04T10:00:00.000Z";
const TOKEN_FRAGMENT = `invite-1.${"A".repeat(43)}`;

function createService(now = NOW) {
  return new InviteTokenService({
    pepper: Buffer.alloc(32, 0x5a),
    now: () => now,
  });
}

describe("InviteTokenService", () => {
  it("supports the one-argument issue contract with a seven-day version-one record", () => {
    const issued = createService().issue("invite-default");

    expect(issued).toMatchObject({
      version: 1,
      expiresAt: "2026-09-04T10:00:00.000Z",
      digest: expect.any(String),
    });
    expect(createService().verify(issued.urlFragment, issued.digest)).toBe(true);
  });

  it("issues independent URL-safe 256-bit secrets without putting them in the stored digest", () => {
    const service = createService();
    const first = service.issue("invite-1", { version: 1, expiresAt: EXPIRES_AT });
    const second = service.issue("invite-1", { version: 1, expiresAt: EXPIRES_AT });
    const firstSecret = first.urlFragment.split(".")[1];

    expect(first.urlFragment).toMatch(/^invite-1\.[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(firstSecret!, "base64url")).toHaveLength(32);
    expect(second.urlFragment).not.toBe(first.urlFragment);
    expect(first).toMatchObject({ version: 1, expiresAt: EXPIRES_AT, digest: expect.any(String) });
    expect(first.digest).not.toContain(firstSecret);
    expect(first.digest).not.toContain(first.urlFragment);
  });

  it("verifies only the matching invite, secret, digest version, and unexpired record", () => {
    const service = createService();
    const issued = service.issue("invite-1", { version: 3, expiresAt: EXPIRES_AT });
    const wrong = service.issue("invite-1", { version: 3, expiresAt: EXPIRES_AT });
    const rotated = service.issue("invite-1", { version: 4, expiresAt: EXPIRES_AT });

    expect(service.verify(issued.urlFragment, issued.digest)).toBe(true);
    expect(service.verify(wrong.urlFragment, issued.digest)).toBe(false);
    expect(service.verify(issued.urlFragment.replace("invite-1", "invite-2"), issued.digest)).toBe(false);
    expect(service.verify(issued.urlFragment, rotated.digest)).toBe(false);
  });

  it("returns false without throwing for malformed, corrupted, and expired values", () => {
    const service = createService();
    const issued = service.issue("invite-1", { version: 1, expiresAt: EXPIRES_AT });
    const expiredService = createService(new Date("2026-09-04T10:00:00.001Z"));

    for (const candidate of ["", "invite-1", "invite-1.not+base64", ".secret", "invite-1.secret.extra"]) {
      expect(() => service.verify(candidate, issued.digest)).not.toThrow();
      expect(service.verify(candidate, issued.digest)).toBe(false);
    }
    expect(service.verify(issued.urlFragment, "not-a-digest")).toBe(false);
    expect(expiredService.verify(issued.urlFragment, issued.digest)).toBe(false);
  });

  it("rejects unsafe identifiers, weak peppers, invalid versions, and invalid expiry", () => {
    expect(() => new InviteTokenService({ pepper: "too-short" })).toThrow(/pepper/i);
    const service = createService();

    for (const inviteId of ["", ".", "..", "bad.id", "bad/id", "a".repeat(65)]) {
      expect(() => service.issue(inviteId, { version: 1, expiresAt: EXPIRES_AT })).toThrow(/invite/i);
    }
    expect(() => service.issue("invite-1", { version: 0, expiresAt: EXPIRES_AT })).toThrow(/version/i);
    expect(() => service.issue("invite-1", { version: 1, expiresAt: NOW.toISOString() })).toThrow(/expiry/i);
  });

  it("does not write raw token material to console output", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const issued = createService().issue("invite-1", { version: 1, expiresAt: EXPIRES_AT });

    expect(createService().verify(issued.urlFragment, issued.digest)).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("buildInvitationAcceptanceUrl", () => {
  it("places the complete raw token only in the browser fragment", () => {
    const link = buildInvitationAcceptanceUrl({
      dashboardUrl: "https://dashboard.example",
      tokenFragment: TOKEN_FRAGMENT,
      runtimeMode: "production",
    });
    const parsed = new URL(link);

    expect(`${parsed.origin}${parsed.pathname}${parsed.search}`).toBe("https://dashboard.example/invite");
    expect(parsed.hash).toBe(`#token=${TOKEN_FRAGMENT}`);
  });

  it("requires a clean public HTTPS origin in production", () => {
    for (const dashboardUrl of [
      "http://dashboard.example",
      "https://localhost:3010",
      "https://127.0.0.1:3010",
      "https://user:pass@dashboard.example",
      "https://dashboard.example/base",
      "https://dashboard.example?state=1",
      "https://dashboard.example#state",
    ]) {
      expect(() => buildInvitationAcceptanceUrl({ dashboardUrl, tokenFragment: TOKEN_FRAGMENT, runtimeMode: "production" })).toThrow(/dashboard/i);
    }
  });

  it("rejects loopback, private, link-local, and internal-style production hosts", () => {
    const rejectedHosts = [
      "https://127.0.0.2",
      "https://10.20.30.40",
      "https://172.16.0.1",
      "https://172.31.255.254",
      "https://192.168.1.20",
      "https://169.254.169.254",
      "https://[::1]",
      "https://[fc00::1]",
      "https://[fd12:3456::1]",
      "https://[fe80::1]",
      "https://dashboard.local",
      "https://dashboard.internal",
      "https://intranet",
    ];

    for (const dashboardUrl of rejectedHosts) {
      expect(() => buildInvitationAcceptanceUrl({ dashboardUrl, tokenFragment: TOKEN_FRAGMENT, runtimeMode: "production" })).toThrow(/dashboard/i);
    }
  });

  it("allows loopback HTTP only when local or test mode is explicit", () => {
    expect(buildInvitationAcceptanceUrl({
      dashboardUrl: "http://localhost:3010",
      tokenFragment: TOKEN_FRAGMENT,
      runtimeMode: "test",
    })).toBe(`http://localhost:3010/invite#token=${TOKEN_FRAGMENT}`);
    expect(() => buildInvitationAcceptanceUrl({
      dashboardUrl: "http://example.test",
      tokenFragment: TOKEN_FRAGMENT,
      runtimeMode: "test",
    })).toThrow(/dashboard/i);
    expect(buildInvitationAcceptanceUrl({
      dashboardUrl: "http://127.0.0.2:3010",
      tokenFragment: TOKEN_FRAGMENT,
      runtimeMode: "development",
    })).toBe(`http://127.0.0.2:3010/invite#token=${TOKEN_FRAGMENT}`);
  });
});
