# Docker & Kubernetes Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the NestJS API with a multi-stage Dockerfile, run local dev + isolated e2e tests via docker-compose, and ship base kubernetes manifests (API only; Mongo external).

**Architecture:** Multi-stage Dockerfile (`deps` → `build` → `prod-deps` → `dev` / `prod`). Local compose uses two Mongo containers (dev on 27017, test on 27018). New `/health` endpoint backs Docker HEALTHCHECK and kube probes. Kubernetes manifests use kustomize base + prod overlay.

**Tech Stack:** NestJS 11, Node 22 (alpine), Yarn, MongoDB 7, Docker, docker-compose v2, kustomize.

**Spec:** `docs/superpowers/specs/2026-04-15-docker-kube-design.md`

---

## File Structure

**New files:**
- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`
- `docker-compose.test.yml`
- `src/health/health.module.ts`
- `src/health/health.controller.ts`
- `src/health/health.controller.spec.ts`
- `deploy/k8s/base/deployment.yaml`
- `deploy/k8s/base/service.yaml`
- `deploy/k8s/base/configmap.yaml`
- `deploy/k8s/base/secret.example.yaml`
- `deploy/k8s/base/kustomization.yaml`
- `deploy/k8s/overlays/prod/kustomization.yaml`
- `deploy/k8s/overlays/prod/patch-deployment.yaml`

**Modified:**
- `src/app.module.ts` — import `HealthModule`
- `src/main.ts` — `app.enableShutdownHooks()`
- `package.json` — `docker:dev`, `docker:test`, `docker:down` scripts
- `.gitignore` — exclude real k8s secret manifests

---

## Task 1: Add `/health` endpoint

**Files:**
- Create: `src/health/health.controller.spec.ts`
- Create: `src/health/health.controller.ts`
- Create: `src/health/health.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/health/health.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const makeController = async (readyState: number) => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: { readyState } },
      ],
    }).compile();
    return module.get<HealthController>(HealthController);
  };

  it('returns ok when mongo readyState is 1', async () => {
    const controller = await makeController(1);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.mongo).toBe('up');
    expect(typeof result.uptime).toBe('number');
  });

  it('throws 503 when mongo readyState is not 1', async () => {
    const controller = await makeController(0);
    await expect(controller.check()).rejects.toMatchObject({
      status: 503,
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `yarn test src/health/health.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement controller**

Create `src/health/health.controller.ts`:

```ts
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  async check() {
    const mongoUp = this.connection.readyState === 1;
    if (!mongoUp) {
      throw new HttpException(
        { status: 'error', mongo: 'down', uptime: process.uptime() },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      status: 'ok',
      mongo: 'up',
      uptime: process.uptime(),
    };
  }
}
```

Create `src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 4: Wire into AppModule**

In `src/app.module.ts`, add import near the other module imports:

```ts
import { HealthModule } from './health/health.module';
```

and add `HealthModule` to the `imports` array (place it right after `DatabaseModule`).

- [ ] **Step 5: Verify throttler/auth do not block /health**

Run: `yarn grep -nR "APP_GUARD\|useGlobalGuards" src` (or use Grep tool) to confirm no global guard blocks the `health` route. The throttler is module-imported via `throttlerConfig` in AppModule but isn't globally binding; no action required. If a global guard exists that blocks `/health`, add `@Public()`/`@SkipThrottle()` decorators as appropriate.

- [ ] **Step 6: Run tests**

Run: `yarn test src/health/health.controller.spec.ts`
Expected: 2 passing tests.

- [ ] **Step 7: Smoke-test against running app (optional)**

If you have Mongo running: `yarn start:dev`, then `curl -i http://localhost:3001/api/health`.
Expected: `HTTP/1.1 200`, JSON `{"status":"ok","mongo":"up","uptime":...}`.

Note: the global prefix `api` is set in `main.ts`, so the full path is `/api/health`. All probes/healthchecks in later tasks must use `/api/health`.

- [ ] **Step 8: Commit**

```bash
git add src/health src/app.module.ts
git commit -m "feat(health): add /api/health endpoint with mongo readiness check"
```

---

## Task 2: Enable graceful shutdown hooks

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add enableShutdownHooks**

In `src/main.ts`, after `const app = await NestFactory.create(...)`, add:

```ts
app.enableShutdownHooks();
```

Final file becomes:

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableShutdownHooks();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on :${port}`);
}
void bootstrap();
```

- [ ] **Step 2: Verify build**

Run: `yarn build`
Expected: succeeds, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(app): enable nest shutdown hooks for graceful termination"
```

---

## Task 3: Create `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Write the file**

Create `.dockerignore`:

```
node_modules
dist
coverage
.git
.gitignore
.env
.env.*
!.env.example
test
**/*.spec.ts
.vscode
.idea
*.md
!README.md
Dockerfile
docker-compose*.yml
deploy
.DS_Store
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.temp
.tmp
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore"
```

---

## Task 4: Create multi-stage Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile`:

```dockerfile
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
```

- [ ] **Step 2: Build prod image**

Run: `docker build --target prod -t nuebics-api:local .`
Expected: successful build. Note the final image size with `docker images nuebics-api:local`.

- [ ] **Step 3: Build dev image**

Run: `docker build --target dev -t nuebics-api:dev .`
Expected: successful build.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: add multi-stage Dockerfile (dev + prod targets)"
```

---

## Task 5: docker-compose for local dev

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the compose file**

Create `docker-compose.yml`:

```yaml
services:
  mongo:
    image: mongo:7
    container_name: nuebics-mongo
    restart: unless-stopped
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval \"db.adminCommand('ping').ok\" | grep -q 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  mongo-test:
    image: mongo:7
    container_name: nuebics-mongo-test
    restart: unless-stopped
    ports:
      - "27018:27017"
    tmpfs:
      - /data/db
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval \"db.adminCommand('ping').ok\" | grep -q 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  api:
    build:
      context: .
      target: dev
    container_name: nuebics-api
    restart: unless-stopped
    env_file:
      - .env
    environment:
      MONGODB_URI: mongodb://mongo:27017/nuebics
      PORT: "3001"
    ports:
      - "3001:3001"
    volumes:
      - ./src:/app/src
      - ./test:/app/test
      - ./tsconfig.json:/app/tsconfig.json
      - ./tsconfig.build.json:/app/tsconfig.build.json
      - ./nest-cli.json:/app/nest-cli.json
      - /app/node_modules
    depends_on:
      mongo:
        condition: service_healthy

volumes:
  mongo-data:
```

- [ ] **Step 2: Sanity-check compose file**

Run: `docker compose config`
Expected: prints a merged YAML with no errors.

- [ ] **Step 3: Bring the stack up**

Run: `docker compose up -d --build`
Wait for healthchecks. Then: `curl -i http://localhost:3001/api/health`
Expected: `HTTP/1.1 200` with `{"status":"ok","mongo":"up",...}`.

If `.env` is missing required vars (JWT/crypto secrets), copy from `.env.example` and fill placeholder dev values first.

- [ ] **Step 4: Tear down**

Run: `docker compose down`
Expected: clean shutdown. `mongo-data` volume persists.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "build: add docker-compose for local dev (api + mongo + mongo-test)"
```

---

## Task 6: docker-compose override for e2e tests

**Files:**
- Create: `docker-compose.test.yml`

- [ ] **Step 1: Write the override file**

Create `docker-compose.test.yml`:

```yaml
services:
  api-test:
    build:
      context: .
      target: dev
    image: nuebics-api:dev
    container_name: nuebics-api-test
    env_file:
      - .env.test
    environment:
      NODE_ENV: test
      MONGODB_URI: mongodb://mongo-test:27017/nuebics-test
      TEST_MONGODB_URI: mongodb://mongo-test:27017/nuebics-test
    volumes:
      - ./src:/app/src
      - ./test:/app/test
      - ./tsconfig.json:/app/tsconfig.json
      - ./tsconfig.build.json:/app/tsconfig.build.json
      - ./nest-cli.json:/app/nest-cli.json
      - /app/node_modules
    depends_on:
      mongo-test:
        condition: service_healthy
    command: ["yarn", "test:e2e"]
```

- [ ] **Step 2: Run e2e tests in container**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm api-test
```
Expected: all existing e2e suites run against `mongo-test`, exit code 0 (or the same failures already present per `test/FINDINGS.md`).

- [ ] **Step 3: Verify dev Mongo untouched**

If dev `mongo` is running, connect to it and confirm no `nuebics-test` DB was created there:
```bash
docker compose exec mongo mongosh --quiet --eval "db.adminCommand('listDatabases').databases.map(d => d.name)"
```
Expected: `nuebics-test` is NOT in the list.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.test.yml
git commit -m "build: add docker-compose.test.yml for isolated e2e test runs"
```

---

## Task 7: npm convenience scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add three scripts**

In `package.json` `"scripts"` block, add:

```json
"docker:dev": "docker compose up --build",
"docker:test": "docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm api-test",
"docker:down": "docker compose down"
```

Place them after `"test:e2e"`.

- [ ] **Step 2: Verify scripts parse**

Run: `yarn run --silent 2>&1 | grep docker:`
Expected: the three scripts are listed.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add docker:dev, docker:test, docker:down npm scripts"
```

---

## Task 8: Ignore real k8s secret files

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append ignore rules**

Append to `.gitignore`:

```

# Kubernetes: keep .example committed, ignore real secrets
deploy/k8s/**/secret.yaml
deploy/k8s/**/secrets.yaml
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): ignore real k8s secret manifests"
```

---

## Task 9: Kubernetes base manifests

**Files:**
- Create: `deploy/k8s/base/deployment.yaml`
- Create: `deploy/k8s/base/service.yaml`
- Create: `deploy/k8s/base/configmap.yaml`
- Create: `deploy/k8s/base/secret.example.yaml`
- Create: `deploy/k8s/base/kustomization.yaml`

- [ ] **Step 1: Write Deployment**

Create `deploy/k8s/base/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nuebics-api
  labels:
    app: nuebics-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nuebics-api
  template:
    metadata:
      labels:
        app: nuebics-api
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: api
          image: nuebics-api:latest
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3001
          envFrom:
            - configMapRef:
                name: nuebics-api-config
            - secretRef:
                name: nuebics-api-secrets
          livenessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
```

- [ ] **Step 2: Write Service**

Create `deploy/k8s/base/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nuebics-api
  labels:
    app: nuebics-api
spec:
  type: ClusterIP
  selector:
    app: nuebics-api
  ports:
    - name: http
      port: 3001
      targetPort: http
```

- [ ] **Step 3: Write ConfigMap (non-secret env)**

Create `deploy/k8s/base/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nuebics-api-config
data:
  NODE_ENV: "production"
  PORT: "3001"
  MAX_FILES: "50"
  AWS_REGION: "ap-south-2"
```

- [ ] **Step 4: Write Secret example**

Create `deploy/k8s/base/secret.example.yaml`:

```yaml
# Copy to secret.yaml and fill in real values. secret.yaml is gitignored.
apiVersion: v1
kind: Secret
metadata:
  name: nuebics-api-secrets
type: Opaque
stringData:
  MONGODB_URI: "mongodb://user:pass@host:27017/db?ssl=true&replicaSet=rs0&authSource=admin"
  JWT_ACCESS_SECRET: "change-me-min-32-characters-xxxxxxxx"
  JWT_REFRESH_SECRET: "change-me-min-32-characters-xxxxxxx"
  CRYPTO_SECRET: "change-me-min-32-characters-xxxxxxxxxx"
  AWS_ACCESS_KEY_ID: "AKIA..."
  AWS_SECRET_ACCESS_KEY: "..."
  AWS_S3_BUCKET_NAME: "your-bucket"
  CRON_SECRET: "change-me"
```

- [ ] **Step 5: Write base kustomization**

Create `deploy/k8s/base/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
  - configmap.yaml
```

Note: `secret.example.yaml` is intentionally NOT listed — it's a template. The real `secret.yaml` is applied separately (or via the prod overlay once filled in).

- [ ] **Step 6: Validate base**

Run: `kubectl kustomize deploy/k8s/base`
Expected: prints merged YAML with no errors.

- [ ] **Step 7: Commit**

```bash
git add deploy/k8s/base
git commit -m "build(k8s): add base manifests (deployment, service, configmap, secret example)"
```

---

## Task 10: Kubernetes prod overlay

**Files:**
- Create: `deploy/k8s/overlays/prod/kustomization.yaml`
- Create: `deploy/k8s/overlays/prod/patch-deployment.yaml`

- [ ] **Step 1: Write overlay kustomization**

Create `deploy/k8s/overlays/prod/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: nuebics
resources:
  - ../../base
images:
  - name: nuebics-api
    newTag: latest
patches:
  - path: patch-deployment.yaml
    target:
      kind: Deployment
      name: nuebics-api
```

- [ ] **Step 2: Write deployment patch**

Create `deploy/k8s/overlays/prod/patch-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nuebics-api
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          resources:
            requests:
              cpu: "200m"
              memory: "384Mi"
            limits:
              cpu: "1000m"
              memory: "768Mi"
```

- [ ] **Step 3: Validate overlay**

Run: `kubectl kustomize deploy/k8s/overlays/prod`
Expected: prints merged YAML, shows `replicas: 2`, namespace `nuebics`, and updated resources.

- [ ] **Step 4: Commit**

```bash
git add deploy/k8s/overlays
git commit -m "build(k8s): add prod overlay (2 replicas, bumped resources)"
```

---

## Task 11: Final verification

- [ ] **Step 1: Fresh build of prod image**

Run: `docker build --target prod -t nuebics-api:verify .`
Expected: builds successfully.

- [ ] **Step 2: Compose dev up + health check**

Run: `docker compose up -d --build`
Wait ~20s, then: `curl -sf http://localhost:3001/api/health`
Expected: `{"status":"ok","mongo":"up","uptime":...}`. Exit code 0.

- [ ] **Step 3: Run e2e suite in container**

Run: `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm api-test`
Expected: jest runs against `mongo-test`. Pass/fail should match current host-run behavior (see `test/FINDINGS.md` for known failures — they are not regressions caused by this plan).

- [ ] **Step 4: Tear down**

Run: `docker compose down -v`
Expected: clean. The final `-v` also removes the `mongo-data` volume; only do this when you want a fresh DB.

- [ ] **Step 5: Validate all kustomize manifests**

Run:
```bash
kubectl kustomize deploy/k8s/base > /tmp/base.yaml
kubectl kustomize deploy/k8s/overlays/prod > /tmp/prod.yaml
```
Expected: both commands succeed and produce non-empty output.

- [ ] **Step 6: No further commit**

Verification only — nothing to commit unless an issue was found and fixed in an earlier step. If any fix was needed, commit it now with an appropriate message.
