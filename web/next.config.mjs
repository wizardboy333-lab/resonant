/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "*.ggpht.com" },
    ],
  },
  // /api-proxy is handled at RUNTIME by app/api-proxy/[...path]/route.ts
  // (rewrites bake destination at build time and break on Render Docker builds).
};

export default nextConfig;
