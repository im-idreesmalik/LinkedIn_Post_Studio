/**
 * Edge middleware for route protection. Uses ONLY the edge-safe authConfig
 * (no DB). Gating logic lives in authConfig.callbacks.authorized.
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
