import { describe, expect, it } from "vitest";
import { parsePlatformMeta, PLATFORM_META_CONTRACT_VERSION } from "./meta";

const valid = {
  service: "vijeeta-platform",
  api_version: "4.0.0",
  contract_version: "2026-08-26",
  status: "ok",
  legacy_reference: "v3",
};

describe("parsePlatformMeta", () => {
  it("accepts the exact V4 meta response", () => {
    expect(parsePlatformMeta(valid)).toEqual(valid);
    expect(PLATFORM_META_CONTRACT_VERSION).toBe("2026-08-26");
  });

  it("rejects unknown fields and wrong versions", () => {
    expect(() => parsePlatformMeta({ ...valid, api_version: "3.0.0" })).toThrow();
    expect(() => parsePlatformMeta({ ...valid, unexpected: true })).toThrow();
  });
});
