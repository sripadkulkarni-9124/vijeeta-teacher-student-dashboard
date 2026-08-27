import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const INVITE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOKEN_SECRET = /^[A-Za-z0-9_-]{43}$/;
const STORED_DIGEST = /^v([1-9][0-9]{0,6})\.([0-9a-z]+)\.([A-Za-z0-9_-]{43})$/;
const MINIMUM_PEPPER_BYTES = 32;

export type InvitationRuntimeMode = "production" | "development" | "test";

export interface IssuedInviteToken {
  urlFragment: string;
  digest: string;
  version: number;
  expiresAt: string;
}

export interface InviteTokenServiceOptions {
  pepper: string | Uint8Array;
  now?: () => Date;
  random?: (size: number) => Uint8Array;
}

export class InviteTokenService {
  private readonly pepper: Buffer;
  private readonly now: () => Date;
  private readonly random: (size: number) => Uint8Array;

  constructor(options: InviteTokenServiceOptions) {
    this.pepper = Buffer.from(options.pepper);
    if (this.pepper.byteLength < MINIMUM_PEPPER_BYTES) {
      throw new Error("Invite token pepper must contain at least 32 bytes");
    }
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? randomBytes;
  }

  issue(inviteId: string, options?: { version: number; expiresAt: string }): IssuedInviteToken {
    assertInviteId(inviteId);
    const now = this.now();
    const version = options?.version ?? 1;
    const requestedExpiry = options?.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    assertVersion(version);
    const expiresAt = parseFutureExpiry(requestedExpiry, now);
    const expiresAtMs = Date.parse(expiresAt);
    const secretBytes = Buffer.from(this.random(32));
    if (secretBytes.byteLength !== 32) throw new Error("Invite token generator must return 32 bytes");
    const secret = secretBytes.toString("base64url");

    return {
      urlFragment: `${inviteId}.${secret}`,
      digest: `v${version}.${expiresAtMs.toString(36)}.${this.digest(inviteId, secret, version, expiresAtMs)}`,
      version,
      expiresAt,
    };
  }

  verify(serialized: string, storedDigest: string): boolean {
    try {
      const digestParts = STORED_DIGEST.exec(storedDigest);
      if (!digestParts) return false;
      const version = Number(digestParts[1]);
      const expiresAtMs = Number.parseInt(digestParts[2]!, 36);
      if (!Number.isSafeInteger(version) || version < 1 || version > 1_000_000 || !Number.isSafeInteger(expiresAtMs)) return false;
      if (this.now().getTime() >= expiresAtMs) return false;
      const separator = serialized.indexOf(".");
      if (separator <= 0 || separator !== serialized.lastIndexOf(".")) return false;
      const inviteId = serialized.slice(0, separator);
      const secret = serialized.slice(separator + 1);
      if (!INVITE_ID.test(inviteId) || !TOKEN_SECRET.test(secret)) return false;

      const candidate = Buffer.from(this.digest(inviteId, secret, version, expiresAtMs), "base64url");
      const expected = Buffer.from(digestParts[3]!, "base64url");
      return candidate.byteLength === expected.byteLength && timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  }

  private digest(inviteId: string, secret: string, version: number, expiresAtMs: number): string {
    return createHmac("sha256", this.pepper)
      .update(`v${version}\0${expiresAtMs}\0${inviteId}\0${secret}`, "utf8")
      .digest("base64url");
  }
}

export function buildInvitationAcceptanceUrl(input: {
  dashboardUrl: string;
  tokenFragment: string;
  runtimeMode: InvitationRuntimeMode;
}): string {
  const base = validateDashboardBaseUrl(input.dashboardUrl, input.runtimeMode);
  if (!isSerializedToken(input.tokenFragment)) throw new Error("Invitation token fragment is invalid");
  const link = new URL("/invite", base);
  link.hash = `token=${input.tokenFragment}`;
  return link.toString();
}

export function validateDashboardBaseUrl(value: string, runtimeMode: InvitationRuntimeMode): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Dashboard URL must be an absolute URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Dashboard URL must be a clean origin");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (runtimeMode === "production") {
    if (url.protocol !== "https:" || loopback) throw new Error("Dashboard URL must be a public HTTPS origin");
  } else if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("Dashboard URL must use loopback in local/test mode");
  }
  return url;
}

function assertInviteId(value: string): void {
  if (!INVITE_ID.test(value)) throw new Error("Invite ID is invalid");
}

function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error("Invite token version is invalid");
}

function parseFutureExpiry(value: string, now: Date): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now.getTime()) throw new Error("Invite token expiry must be in the future");
  return new Date(timestamp).toISOString();
}

function isSerializedToken(value: string): boolean {
  const separator = value.indexOf(".");
  return separator > 0
    && separator === value.lastIndexOf(".")
    && INVITE_ID.test(value.slice(0, separator))
    && TOKEN_SECRET.test(value.slice(separator + 1));
}
