import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow hot reload when accessing from local network IP (e.g. mobile phone)
  allowedDevOrigins: ['192.168.40.7'],
};

export default nextConfig;
