# ---- Single image used for both the Next.js app and the pg-boss worker ----
# Build:  docker build -t linkedin-studio .
# The container's command is overridden per-service in docker-compose.yml.

FROM node:20-bookworm-slim AS base
WORKDIR /app
# sharp needs libvips at runtime; node:bookworm-slim ships a compatible glibc.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---- build (Next.js standalone) ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# App: Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Worker: needs source + tsx + node_modules (run via `npm run worker:start`)
COPY --from=build /app/worker ./worker
COPY --from=build /app/lib ./lib
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 3000
# Default command runs the web app; the worker service overrides this.
CMD ["node", "server.js"]
