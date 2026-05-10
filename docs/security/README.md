# Security Review — Vault Encryption System

Review of the current end-to-end encryption design across `nuebics-next-ts-app` (frontend) and `nuebics-api` (backend).

For the full system overview, see [`vault-architecture.md`](./vault-architecture.md). For the outer-layer crypto details, see [`encryption.md`](./encryption.md).

---

## Verdict

The **inner crypto** (in the browser) is well-built. AES-256-GCM and PBKDF2 are good choices.

But there are **8 real issues**. Some are serious. Some are easy to fix. Some are bigger design problems.

---

## What is good

- AES-256-GCM is the right cipher (it checks for tampering).
- PBKDF2 with 600,000 rounds meets the OWASP 2023 rule.
- Fresh random salt and IV every time. No reuse.
- The server never sees the file bytes (S3 presigned URLs).
- The server never sees the vault password.
- The server never sees the secret key.
- The marker text check after decrypt is a good extra safety net.
- The `header.iterations` field lets you raise the work factor later without breaking old vaults.

---

## Issues

### Issue 1 — You cannot change your vault password (serious)

`vault-password.service.ts` → `setVerifier` is idempotent. If the verifier is already set, it never overwrites:

```ts
if (user.vaultCredentialVerifier) {
  // returns alreadySet: true, never overwrites
}
```

If a user thinks their password leaked, they cannot change it.

**Fix:** Add a "change password" path. The user gives the old password, you decrypt the verifier (gets the secret key), then re-encrypt the same secret key with the new password. Files do not need to be touched.

---

### Issue 2 — No recovery key (serious)

If a user forgets the vault password → all their files are gone forever.

**Fix:** On vault creation, also generate a random 24-word phrase or 32-byte recovery key. Wrap the same secret key with it too. Store both wrapped versions. Show the recovery key once and ask the user to save it.

---

### Issue 3 — File names and MIME types are stored in plaintext on the server (serious for privacy)

`file.schema.ts`:

```ts
@Prop({ required: true }) name: string;
@Prop({ required: true }) type: string;
```

The encrypted file in S3 hides the contents, but the server's MongoDB stores `name: "tax-return-2024.pdf"` and `type: "application/pdf"` in the clear. This breaks the "end-to-end" promise.

**Fix:** Encrypt name and type with the secret key on the client before sending. Send only opaque IDs and encrypted blobs of metadata.

---

### Issue 4 — The outer `CryptoService` layer uses weak/legacy crypto (medium)

- AES-CBC has **no authentication** (no MAC, no GCM tag). Tampering goes undetected at this layer.
- The KDF is `EVP_BytesToKey` with MD5. Legacy from the 1990s.
- Library is `crypto-js` — not audited and widely seen as old. Node has `crypto` built in.

**Fix:** Switch to AES-256-GCM (Node `crypto` module) with HKDF. Or remove the layer (see Issue 5).

---

### Issue 5 — The outer wrap may not actually add real security (design question)

- The inner blob is already AES-256-GCM with PBKDF2(600k) under the user's password.
- The outer wrap uses one global `CRYPTO_SECRET`. If the server is hacked, that secret is in env.
- So the outer wrap only helps in **one** scenario: a passive DB dump where the attacker did not get the env file.

**Two options:**

- **Option A:** Drop the outer wrap. Cleaner, simpler.
- **Option B:** Keep it but rebuild it with modern crypto. Document it as "defense in depth, not the main lock".

---

### Issue 6 — `generateSecretKey` has a small randomness bias (low)

`vault-crypto.ts`:

```ts
const chars = "abc...@#&*"; // 65 characters
const array = new Uint8Array(length);
crypto.getRandomValues(array);
return Array.from(array, (b) => chars[b % chars.length]).join("");
```

`b % 65` from a uint8 (0–255) introduces modulo bias because 256 / 65 = 3 remainder 61. The first 61 chars appear 4 times each in the byte range, the last 4 appear 3 times.

Small bias. Does not break the system (you have ~783 bits of entropy from 130 chars, way more than needed).

**Fix:** Use rejection sampling, or generate a raw 32-byte AES key with the Web Crypto API and skip the string format (see Issue 7).

---

### Issue 7 — The "secret key" is a string, then PBKDF2 runs on it again (medium — wasted CPU + complexity)

Today:

1. Generate a 130-char random **string**.
2. To encrypt a file, call `encryptFile(file, secretKey)`.
3. Inside, PBKDF2 runs on the string + salt → AES key.
4. AES-GCM uses the key.

The string is already pure random bytes. Running PBKDF2 on it adds **600,000 iterations of CPU work for nothing**. PBKDF2 exists to slow down brute force on weak passwords. You do not have a weak password here.

**Fix:**

- Make the secret a real 256-bit AES key (`crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 })`).
- Export the raw bytes.
- For each file, derive a per-file key with **HKDF** (fast — milliseconds, not seconds).

This will make file encryption and decryption **much faster**.

---

### Issue 8 — No auto-lock after idle (low–medium)

Once the user unlocks the vault, the secret key sits in browser memory. If they walk away from their laptop, anyone can use the app.

**Fix:** Add an idle timeout (5–15 minutes). When it fires, clear the secret key from memory. Force re-unlock.

---

## Smaller things worth knowing

- **`NEXT_PUBLIC_VAULT_VERIFIER` is an env var.** It should be a hardcoded constant in code. If anyone changes the env value, every existing vault breaks the marker check.
- **No version field in the verifier JSON.** Today it is `{ text, key }`. If you ever add a field, old clients break. Add `{ version: 1, text, key }` now.
- **GCM IV is 12 bytes.** Correct size. Per-file fresh salt + key derivation removes any reuse risk.
- **XSS would be game over.** Once unlocked, the secret key is in JS memory. Any injected script can steal it. Make sure CSP is strict, no `eval`, audit any `dangerouslySetInnerHTML`.

---

## Better designs you could move to

### Path A — Light cleanup (1–2 weeks)

- Add change password.
- Add recovery key.
- Encrypt file names and types client-side.
- Drop or rebuild the outer CryptoJS layer.
- Switch `generateSecretKey` to `crypto.subtle.generateKey` + raw export.
- Use HKDF for per-file keys.
- Add idle auto-lock.

This gets you to "industry standard E2E vault" without throwing anything away.

### Path B — Modern crypto stack (medium effort)

- Replace PBKDF2 with **Argon2id** (`argon2-browser`). Modern OWASP top pick. Resists GPU cracking.
- Or use **libsodium** (`libsodium-wrappers`). Audited, single library, gives you secretbox + Argon2id + HKDF.

### Path C — Big picture (bigger effort, but full E2E)

- **Per-device keys.** Each device has a Curve25519 keypair. Master key is encrypted to each device. Adding a new device needs an old device to approve.
- **OPAQUE / SRP login.** Server verifies password without ever seeing it.
- **Padded chunked uploads.** Hide file size from the server.

This is what Proton Drive, Tresorit, and Cryptomator do.

---

## Recommended order to fix

Fastest first:

1. **Fix `setVerifier` to allow password change.** (1 day) — Issue 1
2. **Encrypt file names and MIME types client-side.** (2–3 days) — Issue 3
3. **Add a recovery key on signup.** (3–4 days) — Issue 2
4. **Drop or rebuild the outer CryptoJS layer.** (1 day to drop, 2 days to rebuild) — Issues 4 and 5
5. **Replace string-based secret key with raw AES key + HKDF.** (2–3 days) — Issues 6 and 7
6. **Add idle auto-lock.** (1 day) — Issue 8

After this, your system is at the level of 1Password / Bitwarden's basic design.

---

## Note on secret-key rotation

Not required for v1. Password change covers most "I think I am compromised" cases. Build secret-key rotation only when there is a real user request, a compliance need, or an actual key-leak incident.
