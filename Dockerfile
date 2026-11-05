FROM oven/bun:1.4.3 AS build

WORKDIR /app
COPY . .

RUN bun install --frozen-lockfile --ignore-scripts
RUN cd packages/db && bun ./node_modules/prisma/build/index.js generate --config prisma7.config.ts
RUN cd apps/frontend && bun run build

FROM oven/bun:1.4.3 AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app

FROM caddy:2-alpine AS web

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/frontend/dist/ /srv/
COPY --from=build /app/apps/frontend/public/ /srv/
