import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@acos/ui", "@acos/shared"],
};

export default nextConfig;
