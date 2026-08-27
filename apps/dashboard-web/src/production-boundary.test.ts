import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());

describe("production fixture boundary", () => {
  it("keeps the production root and route graph free of fixture entry points", () => {
    expect(readFileSync(resolve(appRoot, "src/app/page.tsx"), "utf8")).not.toContain("DashboardPrototype");
    expect(existsSync(resolve(appRoot, "src/app/api/demo"))).toBe(false);
    expect(readFileSync(resolve(appRoot, "next.config.ts"), "utf8")).not.toContain("@vijeeta/product-fixtures");
    expect(existsSync(resolve(appRoot, "dev-fixture/app/api/demo/route.ts"))).toBe(true);
    expect(readFileSync(resolve(appRoot, "package.json"), "utf8")).toContain("dev-fixture");
    const dockerfile = readFileSync(resolve(appRoot, "Dockerfile"), "utf8");
    for (const fixtureModule of [
      "apps/dashboard-web/src/components/dashboard-prototype.tsx",
      "apps/dashboard-web/src/components/role-landing.tsx",
      "apps/dashboard-web/src/client/demo-api.ts",
      "apps/dashboard-web/src/client/view-models.ts",
      "apps/dashboard-web/src/server/store.ts",
      "apps/dashboard-web/src/server/service.ts",
    ]) {
      expect(dockerfile).toContain(fixtureModule);
      expect(dockerfile.indexOf(fixtureModule)).toBeGreaterThan(dockerfile.indexOf("RUN rm -f"));
    }
    expect(dockerfile).not.toContain("COPY apps/dashboard-web/dev-fixture");
    expect(dockerfile).not.toContain("COPY packages packages");
    expect(dockerfile).not.toContain("COPY packages/product-fixtures packages/product-fixtures");
    expect(dockerfile).toContain('delete pkg.dependencies["@vijeeta/product-fixtures"]');
  });
});
