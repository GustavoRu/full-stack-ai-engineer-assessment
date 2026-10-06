FROM node:24-slim AS base
# Keeps pnpm non-interactive
ENV CI=true
RUN npm install -g pnpm@10
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json ./
# Amazon RDS certificate authorities, used when NODE_EXTRA_CA_CERTS points here
# The directory is created first because ADD applies --chmod to directories it creates
RUN mkdir /app/certs
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
