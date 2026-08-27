import { loadRuntimeConfig } from "../../../server/runtime-config";

export async function GET(): Promise<Response> {
  const build = process.env.VIJEETA_BUILD_ID ?? "unknown";
  try {
    const config = loadRuntimeConfig();
    return Response.json({ status: "ok", build: config.build, mode: config.mode }, { headers: { "cache-control": "no-store" } });
  } catch {
    const mode = process.env.VIJEETA_RUNTIME_MODE === "production" || process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";
    return Response.json({ status: "unavailable", build, mode }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
