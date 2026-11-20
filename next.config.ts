import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes de servidor que se cargan desde node_modules en lugar de empaquetarse.
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "unpdf", "googleapis", "@google-cloud/pubsub"],
};

export default nextConfig;
