# OTP email delivery — design

Date: 2026-06-16

## Problem

The signup and resend-otp flows generate a 6-digit OTP and store it on the
user, but nothing sends it. There is no mailer in the codebase, so users can
never receive the code they need to verify their email.

## Goal

Wire up email sending over SMTP and deliver the OTP in a simple HTML email
(inline CSS). Email channel only — phone/SMS stays as-is.

## Scope

In scope:

- Add `nodemailer` and send the OTP by email on signup and on email resend.
- Add SMTP config via env vars.
- Simple OTP email template with inline CSS.
- Remove the duplicated `generateOTP()` and make it cryptographically secure.

Out of scope:

- Phone / SMS OTP delivery (left unchanged).
- Welcome emails or any other transactional mail.

## Design

### 1. Env config

Add to `src/config/env.validation.ts` (Zod schema) and `.env.example`:

```
SMTP_HOST     # optional string
SMTP_PORT     # optional number, default 587
SMTP_SECURE   # optional boolean, default false (true for port 465)
SMTP_USER     # optional string
SMTP_PASS     # optional string
MAIL_FROM     # optional string, e.g. "Nuebics <no-reply@nuebics.com>"
```

SMTP fields are optional so existing dev/test setups keep working. If SMTP is
not configured, `MailService` logs a warning at startup and skips sending.

### 2. Mail module

New folder `src/shared/mail/`, mirroring the existing `src/shared/s3` pattern
(a `@Global()` module exporting one service).

- `mail.module.ts` — `@Global()` module, provides and exports `MailService`.
- `mail.service.ts` — builds a nodemailer transport from `ConfigService`.
  - `sendOtp(to: string, code: string, name?: string): Promise<void>`
  - Catches and logs all errors via Nest `Logger`; never throws, so signup and
    resend stay non-blocking.
  - If SMTP is not configured, logs and returns without sending.
- `otp-email.template.ts` — `otpEmailHtml(code: string, name?: string): string`
  returns a simple HTML email with inline CSS. No template engine.

### 3. Shared OTP helper

New `src/auth/otp.util.ts` exporting `generateOtp(): string` using
`crypto.randomInt(100000, 1000000)` (secure, no `Math.random`). Both
`auth.service.ts` and `verification.service.ts` import it; the two local copies
are deleted.

### 4. Wiring

- `auth.service.ts signup()` — inject `MailService`. After the user is created,
  if an email was provided, call `mail.sendOtp(email, emailOTP, name)`.
- `verification.service.ts resendOtp()` — inject `MailService`. For the email
  channel, after saving the new code, call `mail.sendOtp(...)`.
- No controller changes.

### 5. Dependency

Add `nodemailer` (runtime) and `@types/nodemailer` (dev).

## Failure behaviour

Email sending is non-blocking. A send failure is logged but signup and resend
still succeed (return as before). Users can retry via resend-otp.

## Testing

- Unit test `MailService.sendOtp` with a mocked nodemailer transport: sends when
  configured, no-ops + warns when not configured, swallows transport errors.
- Unit test `generateOtp` returns a 6-digit string.
- Update existing auth/verification unit tests to provide a `MailService` mock
  in the testing module and assert `sendOtp` is called on signup / email resend.
