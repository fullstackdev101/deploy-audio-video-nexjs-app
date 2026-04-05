import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PeerJS uses browser-only APIs; we exclude it from server-side bundling
  serverExternalPackages: ["peerjs"],
};

export default nextConfig;
