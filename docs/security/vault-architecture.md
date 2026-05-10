# Vault Architecture

End-to-end overview of how a user's vault password becomes a secret key, how that secret is stored, and how files are encrypted and decrypted across the frontend (`nuebics-next-ts-app`) and backend (`nuebics-api`).

This document describes the **complete envelope-encryption flow**. For the narrower view of just the server-side wrapping primitive, see [`encryption.md`](./encryption.md).

## TL;DR

On vault creation, the browser generates a random 130-char secret key, packages it with a known marker into a JSON envelope, and encrypts that envelope with the user's vault password (PBKDF2 + AES-256-GCM). The backend wraps the result a second time with the global `CRYPTO_SECRET` and stores it as `vaultCredentialVerifier`. On unlock, the backend peels its outer wrap and returns the inner ciphertext; the browser decrypts it with the vault password to recover the secret key. That secret key — never the vault password — is what encrypts and decrypts every file, while file bytes themselves move directly between the browser and S3 via presigned URLs and never touch the API.

---

## 1. The Two Crypto Layers

The system wraps one secret in two independent layers:

| Layer | Where | Algorithm | Wrapping key | Purpose |
|---|---|---|---|---|
| **Inner (client)** | Browser only | AES-256-GCM + PBKDF2-SHA256 (600k iterations) | Derived from user's **vault password** | Server can never decrypt this. Loss of password = loss of files. |
| **Outer (server)** | NestJS API | AES-256-CBC (CryptoJS) | Global `CRYPTO_SECRET` env | DB leak alone is not enough — attacker also needs `CRYPTO_SECRET`. |

The "secret key" is a **130-character random string** — generated once per user, sealed inside the inner layer, and used as the actual encryption key for every uploaded file. The vault password never encrypts a file directly.

---

## 2. Setup — First-Time Vault Creation

Implemented in `nuebics-next-ts-app/components/auth/vault-gate.tsx` → `CreateVaultForm` → `createVaultPassword()`.

1. User picks a vault password in the browser.
2. Browser calls `generateSecretKey(130)` → cryptographically random 130-char string. **This is the long-lived file-encryption key.** It is never re-generated.
3. Browser builds a JSON envelope: `{ text: NEXT_PUBLIC_VAULT_VERIFIER, key: <130-char secret> }`. The constant `text` is a known marker used later to detect a wrong password.
4. Browser calls `encryptString(jsonEnvelope, vaultPassword)` from `lib/vault-crypto.ts` → produces a base64 vault blob with layout `[VALT magic | header | salt | IV | AES-GCM ciphertext]`. The header records `iterations: 600_000` for forward compatibility.
5. Browser POSTs the base64 blob as `encryptedToken` to `/api/auth/vault-password` (Next.js proxy) → forwarded to NestJS `POST /auth/vault-password`.
6. NestJS `VaultPasswordService.setVerifier` (idempotent — won't overwrite if already set) calls `CryptoService.encryptToken`, which wraps the inner ciphertext again with `CRYPTO_SECRET` (CryptoJS AES-CBC) and stores it in `User.vaultCredentialVerifier`.

**Net result in the DB:** one string per user — a CryptoJS-AES-CBC ciphertext whose plaintext is itself a base64 AES-GCM ciphertext whose plaintext is `{text, key}`. The server has never seen `key` or `vaultPassword`.

---

## 3. Login + Unlock — Every Subsequent Session

Login (`auth.service.ts → login`) is independent from the vault: bcrypt-compare on the password, return JWT access (10 min) + refresh (5 days). The user is now authenticated, but the vault is still **locked** — the browser does not yet hold the secret key.

Unlock happens in `vault-gate.tsx → UnlockVaultForm`:

1. Frontend `useQuery` hits `GET /auth/vault-password` (via the Next.js proxy → NestJS controller `vault-password.controller.ts`).
2. NestJS `getVerifier` loads `vaultCredentialVerifier` from Mongo, peels off the outer CryptoJS layer with `CRYPTO_SECRET`, and returns the **inner** AES-GCM ciphertext (still encrypted) as a base64 string.
3. User types their vault password.
4. Browser calls `decryptString(verifier, vaultPassword)`:
   - PBKDF2 derives the AES key with `header.iterations` from inside the blob (so iteration counts can be raised in the future without breaking old vaults).
   - AES-GCM decrypts. **GCM auth-tag failure = wrong password.** No password hash exists on the server side for the vault.
5. Browser parses the JSON, asserts `text === NEXT_PUBLIC_VAULT_VERIFIER` (defence-in-depth check on top of GCM), pulls out `key`, and calls `setVaultPassword(key)` to put it in in-memory state.
6. The vault password itself is now discarded. From here on, only the 130-char secret key is in memory.

If GCM fails or the marker doesn't match → "Incorrect vault password". The server is uninvolved in that decision.

---

## 4. File Upload — How a File Gets Encrypted

The browser is the only place the file ever exists in plaintext. The backend's involvement is restricted to issuing presigned URLs and recording metadata.

1. User picks a file in the dashboard.
2. Browser calls `encryptFile(file, secretKey)` in `lib/vault-crypto.ts` — note the password argument is the **130-char secret key**, not the vault password.
   - Generates fresh 16-byte salt + 12-byte IV (per file — never reused).
   - PBKDF2 derives a 256-bit AES key from `secretKey` + salt.
   - Builds payload `[4-byte meta length | meta JSON {name, type, size} | file bytes]`.
   - AES-256-GCM encrypts payload.
   - Wraps the result in the binary layout: `VALT | version | header length | header JSON | salt | IV | ciphertext+GCM-tag`. The result is a Blob.
3. Browser hits `POST /api/files/upload` → NestJS returns a presigned S3 PUT URL (no file bytes pass through the API).
4. Browser PUTs the encrypted Blob directly to S3.
5. Browser hits `POST /api/files/confirm` → NestJS records the file metadata (S3 key, size, original filename, etc.) in MongoDB.

The backend records *that* a file exists and *where* it lives in S3, but neither the file bytes nor the secret key ever leave the browser.

---

## 5. File Download / Decryption

1. Browser asks NestJS for a presigned S3 GET URL for a file the user owns.
2. Browser fetches the encrypted `.vault` blob from S3 directly.
3. Browser calls `decryptVault(blob, secretKey)`:
   - `peekVaultHeader` (or `parseVaultBinary`) reads the plaintext header — algorithm, iteration count, etc. — without needing the key.
   - PBKDF2 re-derives the AES key from `secretKey` + the stored salt + `header.iterations`.
   - AES-GCM decrypts. **Tag mismatch = corruption or wrong key — no garbled output is ever returned.**
   - Strips the metadata prefix to recover the original `name` + `mimeType`.
4. Browser hands the decrypted Blob to the user (download / preview).

---

## 6. What Lives Where

| Item | Where it lives | Lifetime |
|---|---|---|
| Vault password | User's brain + transient browser memory during unlock | Discarded after unlock |
| 130-char secret key | Browser memory after unlock; sealed inside `vaultCredentialVerifier` at rest | Lifetime of the user account |
| `vaultCredentialVerifier` | `users` collection, MongoDB | Persistent |
| `CRYPTO_SECRET` | NestJS env, `≥ 32 chars` | Configuration — rotation requires re-encrypting every user |
| Encrypted file (`.vault`) | S3 | Persistent |
| File metadata | `files` collection, MongoDB | Persistent |
| JWT access / refresh tokens | httpOnly cookies + `refresh_tokens` collection (SHA-256 hashed) | 10 min / 5 days |

---

## 7. Why This Design Holds Up

- **Server compromise (DB only):** attacker gets ciphertext-of-ciphertext. Needs `CRYPTO_SECRET` to peel the outer layer, then needs each user's vault password to peel the inner. Unusable without both.
- **Server compromise (DB + `CRYPTO_SECRET`):** attacker can peel the outer layer, but the inner blob is still PBKDF2(600k) + AES-GCM under the user's vault password. Brute force only.
- **Wrong password:** GCM tag fails before any plaintext is produced. Plus the `text === VAULT_VERIFIER` marker as a secondary check.
- **Vault password change (future feature):** re-encrypt only the small `{text, key}` envelope. Files in S3 do not move.
- **Upgrading PBKDF2 iterations:** new vaults use the new count, old vaults still decrypt because `header.iterations` is read from the blob itself.

---

## 8. Known Sharp Edges

- **Outer layer is AES-CBC, not authenticated.** See [`encryption.md`](./encryption.md). Tampering is not detected at the outer layer — a bit-flipped `vaultCredentialVerifier` would produce a generic "corrupted" error. The inner GCM layer catches it anyway, but worth knowing.
- **Outer KDF is `EVP_BytesToKey` (MD5).** Acceptable because the input is a high-entropy 32+ char secret from configuration, not a user password.
- **`CRYPTO_SECRET` rotation is a migration.** Changing it invalidates every existing verifier; rotation requires re-encrypting every row.
- **`encryptString` uses `btoa` of a per-byte JS string.** Memory-OK because verifiers are tiny, but do not reuse this path for large payloads — `encryptFile` exists for that.
- **`NEXT_PUBLIC_VAULT_VERIFIER` is a public env var.** That is intentional — it is not a secret, it is a known constant whose only job is the post-decryption sanity check.
