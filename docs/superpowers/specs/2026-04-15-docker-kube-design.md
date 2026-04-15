# Docker & Kubernetes Setup — Design

**Date:** 2026-04-15
**Status:** Approved (pending implementation plan)

## Goal

Containerize the NestJS API (`nuebics-api`) with a multi-stage Dockerfile, a local development workflow via docker-compose (including a separate test database for e2e tests), and Kubernetes manifests for production deployment of the API.

## Non-goals

- In-cluster MongoDB for production. Prod Mongo will be configured later; kube manifests only run the API and consume `MONGODB_URI` from a `Secret`.
- Local Kubernetes development. Local dev uses docker-compose only.
- Ingress / TLS / DNS. These are deferred to the future prod setup.
- Rewriting existing tests.

## Scope summary

| Area | Included |
|---|---|
| Multi-stage Dockerfile (dev + prod targets) | ✅ |
| `.dockerignore` | ✅ |
| `docker-compose.yml` (api + mongo + mongo-test) | ✅ |
| `docker-compose.test.yml` (one-shot e2e runner) | ✅ |
| `/health` endpoint in NestJS | ✅ |
| Graceful shutdown hooks | ✅ |
| Kubernetes manifests (base + prod overlay, kustomize) | ✅ (API only) |
| npm script conveniences | ✅ |
| In-cluster Mongo | ❌ (deferred) |
| Ingress / CI / registry push | ❌ (deferred) |

## Architecture

### Dockerfile (multi-stage)

Single file at repo root. Stages:

1. **`deps`** — `node:22-alpine`. Copies `package.json` + `yarn.lock`. Runs `yarn install --frozen-lockfile` (full deps incl. dev).
2. **`build`** — extends `deps`. Copies source. Runs `yarn build` → `dist/`.
3. **`prod-deps`** — fresh `node:22-alpine`. Runs `yarn install --frozen-lockfile --production` for slim prod `node_modules`.
4. **`dev`** — extends `deps`. `CMD ["yarn", "start:dev"]`. Used only by compose; bind-mounts `./src` and `./test`.
5. **`prod`** (final, default target) — `node:22-alpine`.
   - Installs `dumb-init` via `apk`.
   - Copies `dist/` from `build`, `node_modules/` from `prod-deps`, and `package.json`.
   - Runs as built-in `node` user (uid 1000).
   - `ENV NODE_ENV=production`.
   - `EXPOSE 3001`.
   - `HEALTHCHECK` hits `http://localhost:3001/health`.
   - `ENTRYPOINT ["dumb-init", "--"]`, `CMD ["node", "dist/main"]`.

### `.dockerignore`

Excludes: `node_modules`, `dist`, `.env*`, `.git`, `coverage`, `test/`, `*.md` (except what's needed), IDE files, `.DS_Store`.

### docker-compose.yml (local dev)

Services:

- **`api`** — `build: { target: dev }`. Ports `3001:3001`. `env_file: .env`. Bind-mounts `./src:/app/src`, `./test:/app/test`, anonymous volume for `/app/node_modules`. `depends_on: mongo: condition: service_healthy`.
- **`mongo`** — `image: mongo:7`. Port `27017:27017`. Named volume `mongo-data:/data/db`. Healthcheck: `mongosh --quiet --eval "db.adminCommand('ping').ok" | grep -q 1`.
- **`mongo-test`** — `image: mongo:7`. Port `27018:27017`. **No persistent volume** (ephemeral tmpfs or unnamed). Same healthcheck.

Volumes: `mongo-data`.
Networks: default.

For local dev, the app connects as `mongodb://mongo:27017/nuebics` (no `replicaSet=` or `ssl=`).

### docker-compose.test.yml (override/one-shot runner)

Defines a one-shot `api-test` service:

- Uses `dev` target.
- `command: yarn test:e2e`.
- `env_file: .env.test`, plus explicit `MONGODB_URI=mongodb://mongo-test:27017/nuebics-test` and `TEST_MONGODB_URI=...` same.
- `depends_on: mongo-test: condition: service_healthy`.
- No ports exposed.

Invoked via:
```
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm api-test
```

### Health endpoint (`GET /health`)

New module at `src/health/`:

- `health.controller.ts` — `@Controller('health')` with `@Get()` returning `{ status, mongo, uptime }`.
- Injects Mongoose connection via `@InjectConnection()`. Returns HTTP 200 when `connection.readyState === 1`, else 503.
- Public route — excluded from any global auth guard and from `@nestjs/throttler`.
- Wired into `AppModule`.

### Graceful shutdown

- `src/main.ts` calls `app.enableShutdownHooks()` if not already.
- Kube Deployment sets `terminationGracePeriodSeconds: 30`.
- `dumb-init` ensures SIGTERM propagates in Docker.

### Kubernetes manifests (kustomize)

Directory layout:

```
deploy/k8s/
  base/
    deployment.yaml
    service.yaml
    configmap.yaml
    secret.example.yaml     # placeholder values, committed
    kustomization.yaml
  overlays/
    prod/
      kustomization.yaml    # image tag, replica count, resource limits patch
      patch-deployment.yaml
```

- **Deployment** — 2 replicas (overlay-patchable), image `nuebics-api:<tag>`, container port 3001, non-root, readOnlyRootFilesystem where feasible. `envFrom` both the `ConfigMap` (non-secret) and `Secret` (secret). Liveness probe: `GET /health` every 10s after 15s initial delay; readiness: `GET /health` every 5s. `terminationGracePeriodSeconds: 30`. Modest resource requests/limits (e.g. 100m/500m CPU, 256Mi/512Mi memory).
- **Service** — `ClusterIP` on port 3001 → container port 3001. No Ingress (deferred).
- **ConfigMap** — `NODE_ENV=production`, `PORT=3001`, `MAX_FILES=50`, `AWS_REGION`.
- **Secret.example** — keys for `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRYPTO_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `CRON_SECRET`. Real `secret.yaml` is gitignored.

## Data flow

### Local dev
1. Developer runs `yarn docker:dev` (→ `docker compose up --build`).
2. `mongo` starts, becomes healthy. `api` (dev target) starts with bind-mounted source, Nest watch mode rebuilds on edit. Connects to `mongodb://mongo:27017/nuebics`.
3. Developer hits `http://localhost:3001`.

### Local e2e tests
1. Developer runs `yarn docker:test`.
2. `mongo-test` starts on port 27018, becomes healthy.
3. `api-test` one-shot runs `yarn test:e2e` against `mongo-test`. `test/setup-e2e.ts` is unchanged; it reads `TEST_MONGODB_URI` which now points at `mongo-test`.
4. Container exits with jest's exit code. Dev `mongo` data untouched.

### Production (kube)
1. CI (future) builds `prod` target image, tags, pushes.
2. `kubectl apply -k deploy/k8s/overlays/prod` applies ConfigMap + Secret (manually created from example) + Deployment + Service.
3. Deployment pulls image, starts pods as `node` user. Readiness gate on `/health`.
4. Pods connect to external `MONGODB_URI` from Secret.

## Error handling

- **Mongo down at startup (local):** `depends_on: service_healthy` prevents app from starting until Mongo pings.
- **Mongo drops mid-run:** Mongoose attempts reconnection (default behavior). `/health` returns 503 during disconnect; kube readiness probe removes pod from Service endpoints until recovered.
- **App crash:** kube `restartPolicy: Always` on pods. Compose `restart: unless-stopped` on `api` in dev.
- **SIGTERM handling:** `dumb-init` + `enableShutdownHooks()` → Mongoose closes connections cleanly; in-flight requests drain within `terminationGracePeriodSeconds`.
- **Secret missing in kube:** Pod fails to start (clear `CreateContainerConfigError`). Documented in README snippet.

## Testing strategy

- **Unit tests** (`yarn test`): no DB, run on host as today. Not wrapped in Docker.
- **E2E tests** (`yarn test:e2e`): run via `yarn docker:test` against ephemeral `mongo-test`. Existing jest config and `test/setup-e2e.ts` unchanged.
- **Parallel safety:** dev Mongo (27017) and test Mongo (27018) are separate containers with separate storage; `yarn docker:dev` and `yarn docker:test` can run simultaneously.
- **Verification:** after implementation, run `yarn docker:dev` → hit `GET /health`, confirm mongo=up. Run `yarn docker:test` → confirm all existing e2e suites pass.

## Files added / modified

**Added:**
- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`
- `docker-compose.test.yml`
- `src/health/health.controller.ts`
- `src/health/health.module.ts`
- `deploy/k8s/base/{deployment,service,configmap,secret.example,kustomization}.yaml`
- `deploy/k8s/overlays/prod/{kustomization,patch-deployment}.yaml`

**Modified:**
- `src/app.module.ts` — import `HealthModule`.
- `src/main.ts` — `enableShutdownHooks()` (if not already).
- `package.json` — `docker:dev`, `docker:test`, `docker:down` scripts.
- `.gitignore` — `deploy/k8s/**/secret.yaml` (not the `.example`).

**Not touched:**
- Any existing module, schema, or test file.
- Jest configs.

## npm scripts

```json
"docker:dev": "docker compose up --build",
"docker:test": "docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm api-test",
"docker:down": "docker compose down"
```

## Open items deferred to later work

- Ingress/TLS/DNS for prod.
- CI pipeline + registry push.
- In-cluster MongoDB (StatefulSet or Helm) for prod.
- Horizontal Pod Autoscaler, PodDisruptionBudget, NetworkPolicy.
