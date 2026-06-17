/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained build for the Docker image.
  output: "standalone",
  // sharp + aws-sdk are server-only; keep them out of the client/edge bundle.
  serverExternalPackages: ["sharp", "pg-boss", "postgres", "@aws-sdk/client-s3"],
  // Allow image uploads via Server Actions (default cap is 1 MB).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  images: {
    // Allow serving generated images from the local MinIO/object store.
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "minio" },
    ],
  },
};

export default nextConfig;
