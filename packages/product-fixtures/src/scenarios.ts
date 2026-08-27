import type { SurfaceScenario } from "./types";

const scenarioByQuery = {
  ready: "ready",
  loading: "loading",
  "first-use": "first-use",
  empty: "empty",
  error: "error",
  offline: "offline",
  "permission-denied": "permission-denied",
  suspended: "suspended",
} as const satisfies Readonly<Record<SurfaceScenario, SurfaceScenario>>;

function isSurfaceScenario(value: string): value is SurfaceScenario {
  return Object.hasOwn(scenarioByQuery, value);
}

export function selectSurfaceScenario(queryValue: string | null | undefined): SurfaceScenario {
  return queryValue !== null && queryValue !== undefined && isSurfaceScenario(queryValue)
    ? scenarioByQuery[queryValue]
    : "ready";
}
