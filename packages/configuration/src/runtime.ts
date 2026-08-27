export interface FixtureRuntime {
  dataMode: "fixture";
  networkAccess: "disabled";
}

export const MILESTONE_2_RUNTIME: Readonly<FixtureRuntime> = Object.freeze({
  dataMode: "fixture",
  networkAccess: "disabled",
});

const PROHIBITED_RUNTIME_KEY = /api|endpoint|url|production|prod|live|remote/i;

export function assertFixtureRuntime(runtime: unknown): asserts runtime is FixtureRuntime {
  if (typeof runtime !== "object" || runtime === null || Array.isArray(runtime)) {
    throw new TypeError("Fixture runtime must be an object.");
  }

  const value = runtime as Record<string, unknown>;
  if (value.dataMode !== "fixture") {
    throw new TypeError("Fixture runtime data mode must be fixture.");
  }
  if (value.networkAccess !== "disabled") {
    throw new TypeError("Fixture runtime network access must be disabled.");
  }

  for (const key of Object.keys(value)) {
    if (key !== "dataMode" && key !== "networkAccess" && PROHIBITED_RUNTIME_KEY.test(key)) {
      throw new TypeError(`Fixture runtime rejects API or production key: ${key}.`);
    }
  }
}
