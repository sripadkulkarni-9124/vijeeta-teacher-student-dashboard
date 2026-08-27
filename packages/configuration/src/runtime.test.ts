import { describe, expect, it } from "vitest";

import { MILESTONE_2_RUNTIME, assertFixtureRuntime } from "./runtime";

describe("assertFixtureRuntime", () => {
  it("rejects enabled network access in fixture mode", () => {
    expect(() =>
      assertFixtureRuntime({
        dataMode: "fixture",
        networkAccess: "enabled",
        apiBaseUrl: "https://api.example.com",
      }),
    ).toThrow(/network/i);
  });

  it("rejects API and production-oriented unknown keys", () => {
    expect(() =>
      assertFixtureRuntime({
        dataMode: "fixture",
        networkAccess: "disabled",
        apiBaseUrl: "https://api.example.com",
      }),
    ).toThrow(/api/i);
    expect(() =>
      assertFixtureRuntime({
        dataMode: "fixture",
        networkAccess: "disabled",
        productionMode: true,
      }),
    ).toThrow(/production/i);
  });

  it("accepts the immutable milestone fixture runtime", () => {
    expect(() => assertFixtureRuntime(MILESTONE_2_RUNTIME)).not.toThrow();
    expect(Object.isFrozen(MILESTONE_2_RUNTIME)).toBe(true);
  });
});
