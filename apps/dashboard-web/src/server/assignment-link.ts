import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { ASSIGNMENT_LINK_TOKEN_PATTERN } from "@vijeeta/api-contracts";

/** 256 bits of CSPRNG entropy, encoded as the 43 base64url characters the contract accepts. */
const TOKEN_BYTES = 32;

export interface AssignmentLinkToken {
  /** Returned to the creating teacher once. Never persisted, logged, or re-derivable. */
  token: string;
  /** The only value written to the store. */
  tokenHash: string;
}

export function createAssignmentLinkToken(
  randomToken: () => string = () => randomBytes(TOKEN_BYTES).toString("base64url"),
): AssignmentLinkToken {
  const token = randomToken();
  if (!ASSIGNMENT_LINK_TOKEN_PATTERN.test(token)) {
    throw new Error("Assignment link tokens must be 256 bits of base64url randomness");
  }
  return { token, tokenHash: hashAssignmentLinkToken(token) };
}

export function hashAssignmentLinkToken(token: string): string {
  if (!ASSIGNMENT_LINK_TOKEN_PATTERN.test(token)) {
    throw new Error("Assignment link tokens must be 256 bits of base64url randomness");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Fail-closed constant-time comparison: any malformed token or hash denies access. */
export function assignmentLinkTokenMatches(token: string, tokenHash: string): boolean {
  if (!ASSIGNMENT_LINK_TOKEN_PATTERN.test(token) || !/^[0-9a-f]{64}$/.test(tokenHash)) return false;
  const presented = Buffer.from(hashAssignmentLinkToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
