# Trash auto-purge scheduler — design

Date: 2026-06-17

## Problem

`FoldersHelpers.purgeExpiredTrash()` permanently deletes expired trashed
files/folders (and their S3 objects), but nothing calls it automatically. The
only trigger is `POST /api/cron/purge-trash`, which needs an external caller.
With no external cron set up, trash is never purged.

## Goal

Run the purge automatically on a schedule, inside the API process, with no
extra infrastructure. Keep the manual endpoint for on-demand runs.

## Scope

In scope:

- Add `@nestjs/schedule` and run a daily in-app cron that calls
  `purgeExpiredTrash()`.
- Make the schedule and an on/off switch configurable via env.

Out of scope:

- Multi-instance coordination / leader lock (single instance for now).
- Changing the retention window or the purge logic itself.
- Per-user scheduled purge.

## Design

### 1. Dependency

Add `@nestjs/schedule` (re-exports the `cron` package).

### 2. Env config

Add to `src/config/env.validation.ts` (Zod) and `.env.example`:

```
TRASH_PURGE_CRON      # cron expression, default "0 3 * * *" (daily 03:00)
TRASH_PURGE_ENABLED   # boolean, default true
```

`TRASH_PURGE_ENABLED` lets the job be turned off (e.g. tests, or a deploy that
should not run it).

### 3. Wiring

- Register `ScheduleModule.forRoot()` once in `AppModule`.
- New `TrashPurgeScheduler` service in the cron module, implementing
  `OnModuleInit`. It depends on `FoldersHelpers`, `ConfigService`, and
  `SchedulerRegistry`.
  - On init: if `TRASH_PURGE_ENABLED` is false, log that it is disabled and
    register no job. Otherwise read `TRASH_PURGE_CRON`, build a `CronJob` that
    calls the purge handler, register it with `SchedulerRegistry`, and start it.
  - Uses the dynamic `SchedulerRegistry` API (not the static `@Cron()`
    decorator) so the schedule comes from validated config rather than a raw
    `process.env` read at class-load time.
  - The handler calls `FoldersHelpers.purgeExpiredTrash()` (global, no userId),
    wrapped in try/catch with logging. A failed run logs an error but does not
    crash the app or stop the timer.
- A short comment marks where a leader lock would go if the app ever runs
  multiple replicas.

### 4. Manual endpoint

`POST /api/cron/purge-trash` stays unchanged. Both paths call the same helper.

## Failure behaviour

A purge error is caught and logged; the schedule keeps running. App startup is
not blocked by the job.

## Testing

- Unit test `TrashPurgeScheduler`:
  - enabled → `onModuleInit` registers exactly one job with `SchedulerRegistry`.
  - disabled → registers no job.
  - the purge handler calls `purgeExpiredTrash` and swallows/logs errors.
