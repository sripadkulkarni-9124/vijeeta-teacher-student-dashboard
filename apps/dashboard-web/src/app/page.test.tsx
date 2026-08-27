import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardPrototype } from "@/components/dashboard-prototype";
import { ProductionDashboard } from "@/components/production-dashboard";
import HomePage from "./page";

afterEach(() => vi.unstubAllEnvs());

describe("dashboard entry mode", () => {
  it("always selects the production dashboard in a production runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_MODE", "fixture");
    expect(HomePage().type).toBe(ProductionDashboard);
  });

  it("keeps the fixture prototype available only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_MODE", "fixture");
    expect(HomePage().type).toBe(DashboardPrototype);
  });
});
