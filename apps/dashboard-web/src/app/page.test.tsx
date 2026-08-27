import { describe, expect, it } from "vitest";
import { ProductionDashboard } from "@/components/production-dashboard";
import HomePage from "./page";

describe("dashboard entry mode", () => {
  it("keeps the production root free of the fixture dashboard", () => {
    expect(HomePage().type).toBe(ProductionDashboard);
  });
});
