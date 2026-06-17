# Frontend handoff — API changes (2026-06-17)

This note covers four backend changes made in this round of work, plus the
current file/folder delete (trash) flow so the UI can be built around it.

No code here — just behavior, endpoints, and the steps the frontend needs to do.

---

## 1. What changed (summary)

| # | Change | Frontend impact |
|---|--------|-----------------|
| 1 | OTP codes are now emailed | Real emails are sent on signup and resend. Tell the user to check their inbox. |
| 2 | Email OTP codes expire | An expired code is now rejected. Handle the new "expired" error. |
| 3 | Phone verification is disabled | Remove all phone-verify UI/calls. `resend-otp` only accepts `email`. |
| 4 | Trash auto-purge | Items in trash are now deleted for good after a retention period, automatically. |

---

## 2. Email OTP (signup + verification)

### Signup

- **POST `/api/auth/signup`**
- Body: `name`, `email`, `password`, `confirmPassword`, and optional `phone`.
- On success: `201` with `{ ok: true, message: "Account created successfully" }`.
- A 6-digit verification code is now **emailed to the user**.
- Rate limit: 10 signups per hour.

After signup, send the user to a "check your email / enter code" screen.

### Check verification status

- **GET `/api/auth/verify-email`** (must be logged in)
- Returns `{ email, isVerified }`.

### Submit the code

- **POST `/api/auth/verify-email`** (must be logged in)
- Body: `{ code }` (the 6-digit code).
- On success: `{ ok: true, message: "Email verified successfully.", user_details: {...} }`.
- Error cases (HTTP `400`, message in the body):
  - No code on the account: "No verification code found."
  - **Code expired: "Verification code has expired. Please request a new one."** ← new
  - Wrong code: "Invalid verification code."

**Codes expire 10 minutes after they are issued.** If the user is slow, show
the expired message and point them at "resend".

### Resend the code

- **POST `/api/auth/resend-otp`** (must be logged in)
- Body: `{ channel: "email" }`.
- **Only `"email"` is accepted now.** Sending `"phone"` returns a `400`
  validation error.
- Success: `{ ok: true, message: "Verification code sent." }`.
- Already verified: `{ ok: true, message: "Email already verified." }`.
- Rate limit: 3 resends per 15 minutes.

---

## 3. Phone verification is turned off

There is no SMS provider yet, so phone codes can't be delivered. Phone
verification has been disabled on the backend:

- **Removed endpoints** (they no longer exist — calls will `404`):
  - `GET /api/auth/verify-phone`
  - `POST /api/auth/verify-phone`
- `resend-otp` no longer accepts the `phone` channel (see above).

What still works:

- Signup **still accepts and stores** a phone number. It just isn't verified.
- `isPhoneVerified` will stay `false`.

**Frontend steps:** remove the phone OTP entry screen, the "verify phone"
button, and any `channel: "phone"` resend call. You can keep the phone input on
the signup form if you still want to collect it. This is a temporary state —
phone verification will come back once SMS is wired up.

---

## 4. File & folder delete flow (trash)

Deleting is a **two-stage** system. Deleting moves things to trash (reversible);
a scheduled job permanently removes them later.

All endpoints below require the user to be logged in.

### Stage 1 — Delete (move to trash)

- **Delete a file:** `DELETE /api/files/files/:id`
  - Marks the file as trashed. The actual stored file is kept for now.
- **Delete a folder:** `DELETE /api/files/folders/:id`
  - Marks the folder **and everything inside it** (subfolders + files) as
    trashed, all at once.

Both return a success message like `"<name> moved to trash"`. Nothing is
permanently gone at this point.

### View trash

- **List trash:** `GET /api/files/trash`
- Returns:
  - `folders` — trashed top-level folders (each with a child count).
  - `files` — trashed top-level files.
  - `retentionDays` — how many days items stay in trash before auto-delete.
- Note: it only lists **top-level** trashed items. A file inside a trashed
  folder is not listed on its own — it comes back with its parent on restore.

### Restore

- **Restore an item:** `POST /api/files/trash/restore/:id?type=file` or
  `?type=folder`
- `type` is required and must be `file` or `folder`.
- Restoring a folder brings back the whole folder tree (all its subfolders and
  files) in one call.

### Stage 2 — Permanent delete (automatic)

- Trashed items older than the retention window are **permanently deleted
  automatically**, on a daily schedule. The stored files are removed too.
- Retention window: **30 days in production** (24 hours in the dev/test
  environment). Use the `retentionDays` value from the trash list for any UI
  copy so it always matches the backend.
- Once purged, an item **cannot be restored**.

There is also a manual trigger (`POST /api/cron/purge-trash`) but it is
protected by a secret and is for backend/ops use — the frontend should not call
it.

**Suggested UI copy:** on the trash screen, show something like "Items in trash
are deleted after {retentionDays} days." Confirm before delete is optional since
delete is reversible, but warn clearly on anything that is already in trash.

---

## 5. Frontend action checklist

1. **Signup → email step:** after signup, route the user to enter the code, and
   tell them it was emailed.
2. **Handle expired-code error** on `verify-email` (show the message, offer
   "resend").
3. **Resend uses `channel: "email"` only.** Remove any `"phone"` option.
4. **Remove phone verification UI** and the `verify-phone` calls (those routes
   are gone). Keep the phone field on signup only if you still want to collect
   it.
5. **Trash screen:** read `retentionDays` from `GET /api/files/trash` and show
   "deleted after N days". Make clear that purged items can't be recovered.
