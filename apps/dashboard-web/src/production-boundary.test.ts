import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseV3ReadRoute } from "@vijeeta/api-contracts";

import { V3AssignmentAdapter } from "./server/v3-assignment-adapter";
import { V3InsightAdapter } from "./server/v3-insight-adapter";

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

  it("pins the cloud image build to the approved public Firebase project", () => {
    const cloudBuild = readFileSync(resolve(appRoot, "../../cloudbuild.dashboard.yaml"), "utf8");
    expect(cloudBuild).toContain("--tag=${_IMAGE}");
    expect(cloudBuild).toContain("NEXT_PUBLIC_DASHBOARD_MODE=v3-proxy");
    expect(cloudBuild).toContain("NEXT_PUBLIC_FIREBASE_API_KEY=${_FIREBASE_API_KEY}");
    expect(cloudBuild).toContain("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=neetcompanion-50b1f.firebaseapp.com");
    expect(cloudBuild).toContain("NEXT_PUBLIC_FIREBASE_PROJECT_ID=neetcompanion-50b1f");
    expect(cloudBuild).toContain("NEXT_PUBLIC_FIREBASE_APP_ID=1:840759107103:web:68dfff0b2e8c209babff2a");
    expect(cloudBuild).toContain("asia-south1-docker.pkg.dev/neetcompanion-50b1f/cloud-run-source-deploy/vijeeta-dashboard:");
    expect(cloudBuild).toContain("^[0-9a-f]{40}$");
    expect(cloudBuild).not.toContain("latest");
  });

  it("keeps privileged V3 share and insight routes out of the generic browser BFF", () => {
    expect(() => parseV3ReadRoute(["paperdesk", "shares"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "shares", "SH-1", "results"], new URLSearchParams())).toThrow();
    expect(() => parseV3ReadRoute(["paperdesk", "shares", "SH-1", "student", "uid-1", "analysis"], new URLSearchParams())).toThrow();

    const options = { baseUrl: new URL("https://v3.example.test"), fetchImpl: async () => new Response() };
    expect(new V3AssignmentAdapter(options)).not.toHaveProperty("request");
    expect(new V3AssignmentAdapter(options)).not.toHaveProperty("get");
    expect(new V3InsightAdapter(options)).not.toHaveProperty("request");
    expect(new V3InsightAdapter(options)).not.toHaveProperty("get");
  });
});
