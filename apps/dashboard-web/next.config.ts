import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@vijeeta/api-contracts",
    "@vijeeta/configuration",
    "@vijeeta/design-system",
    "@vijeeta/product-fixtures",
  ],
};

export default nextConfig;
