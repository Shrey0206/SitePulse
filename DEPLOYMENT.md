# SitePulse: Railway deployment checklist

Tick each box as you go. Sections 0–5 take roughly an hour the first time. If a step fails,
the table in section 4 maps the usual symptoms to causes.

Last verified locally: lint clean, typecheck 0 errors, 145/145 tests, `npm audit` 0
vulnerabilities, and the exact Railway build command run under `NODE_ENV=production`.
**Not yet verified:** an actual Railway build/deploy. This checklist is how you find out.

---

## 0. Before you push

- [ ] `git status` shows only changes you intend to ship (deploy config, code fixes,
      dependency updates). Consider three commits so the `nodemailer` 9 → 10 major bump is
      easy to revert on its own.
- [ ] Decide about `Docs/Before Interview Doc.md` (untracked, ~57 KB of personal interview
      notes). Commit it, gitignore it, or leave it out. Don't `git add .` without deciding.
- [ ] `.env` and `.env.test` are gitignored. Never commit them.
- [ ] Local gate passes:
  ```bash
  docker compose up -d postgres mailpit
  npm run migrate:test:up
  npm run lint && npm run typecheck && npm test      # expect 145 passed
  ```
- [ ] Production build works from clean (this is the exact Railway build command):
  ```bash
  # Railway installs the root dependencies itself first; the build command then does the rest.
  npm ci && NODE_ENV=production bash -c "npm --prefix web ci --include=dev && npm run build:all"
  ls dist/index.js web/dist/index.html
  ```

## 1. Generate secrets

Store these in a password manager. **Don't reuse anything from `.env` or `.env.test`**
(the test webhook key is all zeros).

- [ ] `JWT_SECRET`
      `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- [ ] `WEBHOOK_SECRET_KEY`: exactly 32 bytes / 64 hex characters
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [x] ~~An SMTP provider~~ **Not applicable: email is off on Railway.** Railway disables
      outbound SMTP on the Free, Trial and Hobby plans (it is "only available on the Pro plan
      and above"), so email alerts cannot work there whichever provider you pick. Webhook
      alerts are the production alert channel. Email still works locally via Mailpit. To
      enable it later, either move to Railway Pro or add an HTTPS email API such as Resend
      (a code change; DECISIONS.md #21 chose SMTP).

## 2. Create the Railway project

- [ ] New project from the GitHub repo (git-push deploys, per DECISIONS.md #11). Or, with
      the CLI: `railway login`, `railway init`, `railway up`.
- [ ] Add a **PostgreSQL** database to the same project.
- [ ] In the app service settings, confirm Railway picked up `railway.json`: the build
      command, the pre-deploy command (`npm run migrate:up`) and the healthcheck path
      (`/health`) should all be shown.
- [ ] **Replicas = 1.** Do not scale out (see section 7).
- [ ] Networking → generate a public domain. Note the URL as `$URL` below.

## 3. Set variables on the app service **before the first deploy**

The app throws at boot if `DATABASE_URL` or `JWT_SECRET` is missing, so deploying first just
produces a crash loop.

| Variable             | Value                        | Required        | Notes                                                                                                                          |
| -------------------- | ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`       | `${{Postgres.DATABASE_URL}}` | **yes**         | Reference variable. Change `Postgres` if you renamed the DB service.                                                           |
| `JWT_SECRET`         | from section 1               | **yes**         |                                                                                                                                |
| `NODE_ENV`           | `production`                 | **yes**         | Marks the refresh cookie `Secure`. Without it the cookie is sent over plain HTTP.                                              |
| `WEBHOOK_SECRET_KEY` | from section 1               | for webhooks    | The app boots without it, but creating a webhook channel fails.                                                                |
| `SMTP_*`             |                              | **leave unset** | SMTP is blocked on Railway Free/Trial/Hobby (see section 1). Email alerts will not send; use webhooks. Only meaningful on Pro. |
| `BCRYPT_ROUNDS`      |                              | optional        | Default 12.                                                                                                                    |
| `PORT`               |                              | **don't set**   | Railway injects it.                                                                                                            |

## 4. Deploy and watch the logs

Expected sequence in the deployment logs:

1. Build finishes (`npm ci`, both `tsc` builds, `vite build`).
2. Pre-deploy: `npm run migrate:up` prints `Migrations complete!`
3. `SitePulse listening on port <N>`
4. Healthcheck passes and the deployment goes Active.

| Symptom                                            | Likely cause                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tsc: not found` / `sh: tsc`                       | devDependencies were skipped by the root install. Set `NPM_CONFIG_PRODUCTION=false` on the service.    |
| `EBUSY: rmdir '/app/node_modules/.cache'`          | The build command re-runs a root `npm ci`. Don't: Nixpacks already installed and mounts a cache there. |
| `Missing required environment variable: …`         | Variable not set on the **app** service (section 3).                                                   |
| Pre-deploy fails with `ECONNREFUSED` / `ENOTFOUND` | `DATABASE_URL` reference is wrong or points at the wrong service.                                      |
| Pre-deploy fails with a SQL error                  | A migration failed. Nothing is deployed. Read the error and fix the migration.                         |
| Healthcheck never passes                           | `/health` returns 503 when Postgres is unreachable. Check `DATABASE_URL`.                              |
| App serves JSON but `/` is a 404                   | `web/dist` wasn't built. Check the build log for the `vite build` step.                                |

## 5. Smoke test (replace `$URL`)

- [ ] `curl -i $URL/health` returns 200 with `"status":"ok","database":"ok"`.
      `"warning"` means the checker has stalled. Healthcheck still passes on `warning`, so
      look at this yourself.
- [ ] `$URL/` loads the UI, and a hard refresh on `$URL/dashboard/monitors` still loads it.
- [ ] `$URL/api/v1/docs` shows Swagger UI.
- [ ] **Sign up** in the UI. In DevTools → Application → Cookies, `refreshToken` is
      `HttpOnly`, `Secure`, `SameSite=Strict`.
- [ ] Reload the page and you stay signed in (refresh-token flow works).
- [ ] Create a monitor on a site you know is up. A check result appears within one interval
      (10 s minimum).
- [ ] Force a failure (point a monitor at a URL that returns 500, or set an expected status
      the site never returns). After the failure threshold, an **incident opens**.
- [x] **Email alert: skipped on Railway** (SMTP is blocked on this plan, see section 1). An
      email channel's deliveries will show `failed` in production; that is expected.
- [ ] **Webhook alert:** add a webhook channel pointing at a webhook.site URL. A signed
      request arrives. This proves `WEBHOOK_SECRET_KEY` works.
- [ ] Fix the monitor. The incident **resolves** and a recovery alert fires.
- [ ] **Live updates:** keep the dashboard open while a status changes. It updates without a
      reload. This confirms Railway's proxy isn't buffering the SSE stream.
- [ ] The public status page `$URL/status/<org-slug>` loads while logged out.
- [ ] Create an API key and call the API with it (see `$URL/api/v1/docs`).
- [ ] **Redeploy once.** Logs show `SIGTERM received, shutting down`, the app comes back,
      monitors keep running, and `/health` is `ok` again within a couple of cycles.
- [ ] Scan the logs for `Postgres pool error`, `Scheduler tick failed` and
      `Initial partition maintenance failed`. None should repeat.
- [ ] Rate limiting keys on the real client IP: hit login repeatedly from your laptop until
      throttled, then confirm login still works from your phone on mobile data. (If it's
      throttled too, `trust proxy` isn't working and everyone shares one bucket.)

## 6. After it's live

- [ ] Check what backup and retention your Railway plan gives the Postgres volume. The
      `checks` table grows by one row per monitor per interval, so watch database size.
- [ ] Set a usage/spend limit in Railway billing.
- [ ] Optional: add a SitePulse monitor on its own `$URL/health`. It can't alert you when
      it's _down_, so use an external monitor too if this matters.
- [ ] Record the live URL, tick the deploy boxes in `planning/TASKS.md` (Day 1, 26), and log
      the session in `planning/PROGRESS.md`.

## 7. Constraints that must not be broken

- **Run exactly one instance.** The scheduler, the rate limiter and the SSE hub all live in
  process memory (DECISIONS.md #4/#5). Two replicas would run every check twice, send
  duplicate alerts, split rate-limit counters, and deliver SSE events only to clients on the
  instance that produced them.
- **Never lose or rotate `WEBHOOK_SECRET_KEY`.** Webhook secrets are encrypted with it and
  there's no key versioning. A different key makes every stored secret undecryptable, and
  you'd have to recreate every webhook channel.
- Rotating `JWT_SECRET` invalidates every issued access token (users must sign in again).
- Every deploy restarts the process. In-flight checks are lost; state-machine counters are
  persisted, so incident detection resumes (DECISIONS.md #19). Rate-limit counters reset.

## 8. Rollback

- [ ] App: Railway → Deployments → redeploy the previous successful deployment. The
      pre-deploy `migrate:up` is a no-op when the schema is already current.
- [ ] **Rolling back code does not roll back the schema.** The older build must tolerate the
      newer schema. If a migration was destructive, take a database backup _before_
      deploying it.
- [ ] Reverting a migration is a deliberate manual step (`npm run migrate:down` against the
      database's public URL), never part of the deploy.

## 9. Known risks: decide before sharing the URL widely

These are code-level gaps, not config. None blocks a private deploy, but think about them
before publishing the link.

- **SSRF.** Monitor URLs (and webhook URLs) only have to be `http(s)`. Any host is allowed
  and signup is open, so any visitor can make your server request internal addresses
  (`*.railway.internal`, the Postgres service, `localhost`, cloud metadata endpoints) and
  read the result back through status codes, latency and error text on their check
  history. Mitigation: reject private, loopback and link-local addresses after DNS
  resolution (and on redirects), or turn off open signup.
- **Open signup with no verification.** Anyone can create an org and monitors, and your
  server then makes outbound requests on their schedule (every 10 s at the minimum). That's
  an abuse and cost vector.
- **In-memory rate limits** reset on every deploy and don't hold across instances.
