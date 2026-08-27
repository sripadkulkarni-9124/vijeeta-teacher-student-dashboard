import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@vijeeta/api-contracts",
    "@vijeeta/configuration",
    "@vijeeta/design-system",
    "@vijeeta/product-fixtures",
  ],
};

export default nextConfig;
