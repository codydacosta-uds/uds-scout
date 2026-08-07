import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["@cdktf/hcl2json"],
  async redirects() {
    return [
      { source: "/test-lab", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
