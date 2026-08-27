import { getProductionFirebaseRuntime } from "./firebase-runtime";
import { loadRuntimeConfig } from "./runtime-config";

export async function getProductionDashboardRouteDependencies() {
  const config = loadRuntimeConfig();
  const runtime = await getProductionFirebaseRuntime(config);
  return {
    adminBootstrap: config.adminBootstrap,
    verifier: runtime.verifier,
    store: runtime.dashboard,
  };
}
