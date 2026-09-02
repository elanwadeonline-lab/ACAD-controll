/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  env: {
    NEXT_PUBLIC_CONTROL_API_URL: process.env.NEXT_PUBLIC_CONTROL_API_URL || "",
  },
};

export default nextConfig;
