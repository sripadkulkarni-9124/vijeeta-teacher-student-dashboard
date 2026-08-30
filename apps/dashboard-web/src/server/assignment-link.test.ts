import { describe, expect, it } from "vitest";

import {
  assignmentLinkTokenMatches,
  createAssignmentLinkToken,
  hashAssignmentLinkToken,
} from "./assignment-link";

describe("assignment link capability tokens", () => {
  it("mints unguessable tokens and stores only their hash", () => {
    const first = createAssignmentLinkToken();
    const second = createAssignmentLinkToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).not.toContain(first.token);
    expect(first.tokenHash).toBe(hashAssignmentLinkToken(first.token));
  });

  it("rejects tokens that were not generated with full entropy", () => {
    expect(() => createAssignmentLinkToken(() => "short")).toThrow();
    expect(() => hashAssignmentLinkToken("not-a-token")).toThrow();
  });

  it("grants only on an exact token match and fails closed on malformed input", () => {
    const { token, tokenHash } = createAssignmentLinkToken();

    expect(assignmentLinkTokenMatches(token, tokenHash)).toBe(true);
    expect(assignmentLinkTokenMatches(createAssignmentLinkToken().token, tokenHash)).toBe(false);
    expect(assignmentLinkTokenMatches("short", tokenHash)).toBe(false);
    expect(assignmentLinkTokenMatches(token, "")).toBe(false);
    expect(assignmentLinkTokenMatches(token, token)).toBe(false);
    const flipped = `${tokenHash.slice(0, 63)}${tokenHash.at(-1) === "0" ? "1" : "0"}`;
    expect(assignmentLinkTokenMatches(token, flipped)).toBe(false);
  });
});
