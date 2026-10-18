# Better Auth migration plan

Status: **proposed — not started.** No application code has been changed for this plan.

Scope: replace the hand-written authentication implementation with
[Better Auth](https://better-auth.com) (self-hosted, mounted inside the existing
Express API), add the features that motivated the change, and fix the mobile
session failure by moving the SPA and the API under one registrable domain.

## 1. Why

The mobile failure that started this is **not** an auth-code bug. The SPA is
served from `*.vercel.app` and the API from `*.onrender.com`; those are different
registrable domains, so the API's session cookie is a **third-party cookie**.
Safari/iOS blocks it outright and Chrome on Android blocks it for most users, so
`Set-Cookie` is ignored, `/auth/me` returns 401, and the app bounces back to
sign-in after a successful login. Desktop Chrome still permits third-party
cookies, which is why the same build works on a laptop.

Better Auth does not change that. Their own documentation states it, and Neon's
managed option points to the same page:

> "Safari treats `domainA.com` as a third-party and blocks its cookies. Which can
> result in sessions not persisting, `Set-Cookie` being ignored, users appearing
> logged out after login, or auth working in Chrome but failing in Safari."
> — Better Auth, *Safari, ITP, and Cross-Domain Setups*

The prescribed fixes are the same two options for any library: a shared parent
domain, or a reverse proxy. **Step 0 below is therefore required regardless of
the auth library**, and it is the only thing that fixes mobile sign-in.

Better Auth is being adopted for what it adds: Google sign-in, password reset,
email verification, and later MFA/passkeys — not for session transport.

## 2. Verified facts

| Check | Result |
| --- | --- |
| `better-auth` latest | `1.7.10` |
| Prisma peer range | `prisma` and `@prisma/client`: `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0` — Prisma 7.10.1 is supported |
| React peer range | `^18.0.0 \|\| ^19.0.0` — React 19.3.1 is supported |
| Vitest peer range | `^2 \|\| ^3 \|\| ^4 \|\| ^5` — Vitest 4.1.12 is supported |
| Official Prisma guidance | A Prisma 7 + PostgreSQL guide exists; the adapter is `@better-auth/prisma-adapter` |
| Earlier blocker | Issue #6746 (peer dep pinned to `^5.22.0`) is **resolved** and no longer applies |
| Default mount path | `/api/auth` |
| Required secret | `BETTER_AUTH_SECRET` (32+ chars); Better Auth refuses to run in production without it |
| Multi-host | `baseURL` accepts `{ allowedHosts, fallback }`, needed for `*.vercel.app` preview deployments |

## 3. Step 0 — one registrable domain (fixes mobile today)

Independent of Better Auth. Do this first.

Chosen approach: **Vercel proxies `/api/*` to the API** via the `vercel.json` in
this repository, so the browser sees a single origin. No domain purchase is
required. A custom domain remains the tidier long-term option and can replace
the rewrite later with no application change, but it is not needed.

Why a shared parent domain is not available here: `vercel.app` and
`onrender.com` are both on the Public Suffix List, so every hostname under them
is its own *site* and a cookie cannot be shared between them. A single origin is
therefore the only fix.

Configuration:

| Where | Setting |
| --- | --- |
| `vercel.json` (repo root) | rewrite `/api/:path*` → the Render API, plus an SPA fallback to `/index.html` |
| Vercel | `VITE_API_URL` **unset** — the bundle calls `/api/v1/...` on its own origin |
| Render | `CORS_ORIGIN` = the Vercel origin (the CSRF `Origin` check still needs it) |
| Render | `SESSION_COOKIE_SAME_SITE=lax`, `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY=1` |

Result: the session cookie is first-party, so it is stored and sent on every
mobile browser, and `lax` restores the stronger CSRF posture.

Details, caveats and the verification commands: `docs/DEPLOYMENT.md`,
"One origin without a custom domain" and section 5.

## 4. Target architecture

```
better-auth (mounted at /api/auth)   ← identity, sessions, OAuth, reset, verification
/api/v1/*                            ← application data, authorises via the same session
```

- Better Auth owns its tables and its cookie (`better-auth.session_token`).
- `Workspace.ownerUserId` continues to reference the user id; Better Auth becomes
  the source of that id.
- Our `/api/v1/auth/*` routes are retired, except `GET /api/v1/auth/config`,
  which the sign-in screen uses for `registrationEnabled` and `minPasswordLength`
  (Better Auth does not expose those, and the production gate must stay).
- Our middleware keeps doing what it does well: `requireTrustedOrigin` (CSRF),
  Express rate limiting on the auth paths, request logging with redaction, and
  the production configuration guard.

## 5. Phases

### Phase 1 — spike in a worktree (validate before committing)

Run against a **local copy** of the database. Nothing touches Neon or Render.

1. Add `better-auth` + `@better-auth/prisma-adapter`; generate the schema and
   inspect exactly what the CLI writes — confirm it does not clobber
   `apps/api/prisma.config.ts` or the `prisma-client` generator block.
2. Prove the **password bridge**: implement `emailAndPassword.password.hash` and
   `.verify` against the existing
   `scrypt$N$r$p$salt$hash` format in `apps/api/src/lib/password.ts`, backfill
   `account.password` from `User.passwordHash`, and confirm an existing account
   can still sign in with its current password.
3. Decide session-token storage. Our current design stores only the SHA-256 of
   the session token. Confirm whether Better Auth can store the token hashed; if
   it cannot, record that as an accepted, documented downgrade with the
   compensating controls.
4. Confirm `auth.api.getSession()` resolves correctly behind the existing
   cookie/CSRF middleware layering in Express 5.
5. Decide table naming: Better Auth defaults to camelCase (`user`, `session`)
   while our models are PascalCase (`User`, `Session`). Pick either a dedicated
   Postgres schema or explicit `modelName` mapping — not both.

Exit criteria: a real sign-in against the local database with an existing
password hash, and a session that survives a page reload.

### Phase 2 — backend cutover

- New `apps/api/src/lib/auth.ts` holding the Better Auth instance.
- Mount the handler in `apps/api/src/app.ts` **before** `express.json()`, as
  their Express guide requires.
- Rewrite `apps/api/src/middleware/auth.ts` to resolve sessions through
  `auth.api.getSession({ headers })`.
- Retire `/api/v1/auth/{register,login,logout,me,sessions,me/password,me}`. The
  profile, change-password, session-list/revoke, and delete-account screens map
  onto equivalent Better Auth calls, so no product functionality is dropped.
- Re-express `ALLOW_REGISTRATION` as a Better Auth hook so the existing
  server-side control and the production guard keep their meaning.
- Preserve the delete-account behaviour that removes the user's workspaces.
- Migration: additive. Backfill credentials, keep `User.passwordHash` in place
  for one release so a rollback remains possible.

### Phase 3 — frontend cutover

- Adopt the `better-auth/react` client for sign-in, sign-up, sign-out, session,
  password change, session revocation, and account deletion.
- Keep `apps/web/src/features/auth/*` screens and layout; the visual design does
  not change.
- The `INVALID_RESPONSE` handling added in `5e83cdd` stays — it is what turned
  this week's silent failure into a readable one.

### Phase 4 — requested features

| Feature | Depends on |
| --- | --- |
| Password reset | An email provider (Resend, Postmark, or SES) + a verified sending domain |
| Google sign-in | A Google Cloud OAuth client; redirect URI on the Vercel origin: `https://<your-app>.vercel.app/api/auth/callback/google` |
| Email verification | The same email provider as reset |

Email delivery is the long pole for password reset and verification, and it is
independent of the auth library. It needs a provider account and DNS records for
the sending domain, so it cannot be completed inside the repository alone.

### Phase 5 — tests

- `apps/api/tests/helpers/db.ts` currently inserts a `Session` row directly and
  registers the cookie. That must change to obtain a real session through
  Better Auth. This is the one central change; the ~233 API tests keep their
  assertions.
- `apps/api/tests/auth.test.ts` is rewritten against the new endpoints.
- New tests: password reset flow, Google callback (mocked), and a regression
  test that an existing password hash still verifies.
- `isolation.test.ts` (cross-account access) must stay green, unchanged.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Existing users locked out | Password bridge proven in Phase 1 before any cutover; `User.passwordHash` retained for one release |
| Session invalidation on deploy | Accept one forced re-login at cutover; announce it rather than surprising users |
| Prisma model conflicts | Resolved in Phase 1 by choosing either a dedicated schema or explicit `modelName` mapping |
| Better Auth stores session tokens differently | Decide and document in Phase 1; do not silently weaken the current posture |
| Larger auth surface than we wrote | Better Auth is a well-audited library, but the change is reviewed and tested, not assumed |
| Email deliverability | Needs a real sending domain and SPF/DKIM; out of scope for code |

## 7. What is needed from you

1. Nothing for Step 0 — the proxy needs no domain. A domain remains optional;
   it makes the Google redirect URI stable and survives deployment-URL changes.
2. A Google Cloud project and OAuth client for Google sign-in. Register the
   redirect URI on the **Vercel** origin, not the Render one
   (`https://<your-app>.vercel.app/api/auth/callback/google`), because the
   callback must come back through the proxy for the session cookie to stay
   first-party. Set Better Auth's `baseURL` to the Vercel origin for the same
   reason.
3. An email provider account plus a verified sending domain for password reset
   and verification.

## 8. Recommended order

1. **Step 0 now.** It fixes mobile sign-in on its own, this week, with no code
   change and no dependency on the auth work.
2. **Phase 1 spike** while Step 0 propagates.
3. Phases 2–3 as one reviewed change, with the password bridge test as the gate.
4. Phase 4 per provider, starting with password reset (the actual lockout risk —
   registration is open and there is currently no recovery path).
