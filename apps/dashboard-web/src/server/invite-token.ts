import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

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
  const loopback = isLoopbackHost(url.hostname);
  if (runtimeMode === "production") {
    if (url.protocol !== "https:" || loopback || !isPublicHost(url.hostname)) {
      throw new Error("Dashboard URL must be a public HTTPS origin");
    }
  } else if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("Dashboard URL must use loopback in local/test mode");
  }
  return url;
}

function isLoopbackHost(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname) === 4) return Number(hostname.split(".")[0]) === 127;
  if (isIP(hostname) === 6) {
    const groups = parseIpv6(hostname);
    return groups !== null
      && groups.slice(0, 7).every((group) => group === 0)
      && groups[7] === 1;
  }
  return false;
}

function isPublicHost(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname);
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return !isNonPublicIpv4(hostname);
  if (ipVersion === 6) return !isNonPublicIpv6(hostname);
  if (!hostname.includes(".")) return false;
  return ![".localhost", ".local", ".internal", ".localdomain", ".lan", ".home"]
    .some((suffix) => hostname.endsWith(suffix));
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isNonPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second! >= 16 && second! <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second! >= 64 && second! <= 127)
    || first! >= 224;
}

function isNonPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return true;
  const allZeroPrefix = groups.slice(0, 7).every((group) => group === 0);
  if ((allZeroPrefix && groups[7]! <= 1) || (groups[0]! & 0xfe00) === 0xfc00 || (groups[0]! & 0xffc0) === 0xfe80 || (groups[0]! & 0xff00) === 0xff00) {
    return true;
  }
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (ipv4Mapped) {
    const mapped = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
    return isNonPublicIpv4(mapped);
  }
  return false;
}

function parseIpv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
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
