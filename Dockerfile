FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/generator/package.json packages/generator/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/api/tsconfig.build.json apps/api/tsconfig.build.json
COPY apps/api/src apps/api/src
COPY packages/shared packages/shared
COPY packages/generator packages/generator
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/generator/package.json ./packages/generator/package.json
COPY --from=build --chown=node:node /app/packages/generator/dist ./packages/generator/dist
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/health/live',{signal:AbortSignal.timeout(2000)});process.exitCode=r.ok?0:1"]
CMD ["node", "apps/api/dist/server.js"]
