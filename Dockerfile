# syntax=docker/dockerfile:1.7

# ---------- deps: full deps incl. dev ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---------- build: compile TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

# ---------- prod-deps: production-only node_modules ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# ---------- dev: used by docker-compose for hot reload ----------
FROM node:22-alpine AS dev
ENV NODE_ENV=development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["yarn", "start:dev"]

# ---------- prod: slim runtime image ----------
FROM node:22-alpine AS prod
ENV NODE_ENV=production
RUN apk add --no-cache dumb-init wget
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
