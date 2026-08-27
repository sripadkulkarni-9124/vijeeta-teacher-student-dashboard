import type {
  DashboardAction,
  DashboardRole,
  DashboardSnapshot,
} from "@vijeeta/api-contracts";
import {
  DashboardProblemSchema,
  parseDashboardAction,
  parseDashboardSnapshot,
} from "@vijeeta/api-contracts";

export interface DemoApi {
  snapshot(role: DashboardRole): Promise<DashboardSnapshot>;
  mutate(action: DashboardAction): Promise<unknown>;
}

export function createDemoApi(transport: typeof fetch = fetch): DemoApi {
  return {
    async snapshot(role) {
      const response = await transport(`/api/demo?role=${role}`, {
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw toApiError(payload, response.status);
      return parseDashboardSnapshot(payload);
    },
    async mutate(action) {
      const validated = parseDashboardAction(action);
      const response = await transport("/api/demo", {
        body: JSON.stringify(validated),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw toApiError(payload, response.status);
      return payload;
    },
  };
}

export const demoApi = createDemoApi();

function toApiError(payload: unknown, status: number): Error {
  const envelope =
    typeof payload === "object" && payload !== null && "problem" in payload
      ? DashboardProblemSchema.safeParse(
          (payload as { problem: unknown }).problem,
        )
      : null;
  return new Error(
    envelope?.success ? envelope.data.message : `Local API request failed (${status})`,
  );
}
