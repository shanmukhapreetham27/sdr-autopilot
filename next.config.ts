import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without it, Turbopack walks up and
  // finds a stray lockfile in the home directory and warns on every build.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // The campaign list is the home screen of the control plane.
  async redirects() {
    return [{ source: "/", destination: "/campaigns", permanent: false }];
  },
};

export default nextConfig;
