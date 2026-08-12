FROM node:22-bookworm-slim AS build
ARG APP_RELEASE=dev
ENV APP_RELEASE=$APP_RELEASE
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run check

FROM node:22-bookworm-slim AS runtime
ARG APP_RELEASE=dev
ENV APP_RELEASE=$APP_RELEASE
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/poker.db COOKIE_SECURE=true
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "dist-server/index.js"]
