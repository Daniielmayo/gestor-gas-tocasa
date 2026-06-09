import type { NextConfig } from "next";
// @ts-expect-error: next-pwa doesn't have types
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

const nextConfig: NextConfig = {
  // Allow hot reload when accessing from local network IP (e.g. mobile phone)
  allowedDevOrigins: ['192.168.40.7'],
  turbopack: {},
};

export default withPWA(nextConfig);
