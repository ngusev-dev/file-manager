FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit
COPY src ./src
COPY scripts/*.js ./scripts/
COPY db ./db

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./

RUN install -d -o node -g node /app/sandbox
USER node
EXPOSE 8080

CMD ["node", "scripts/health.js"]
