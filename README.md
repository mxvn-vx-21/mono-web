# MONO (web) — Cloudflare Pages + Postgres

No build step. `public/` is the site (plain HTML/CSS/JS). `functions/api/[[path]].js` is the API (Cloudflare Pages Function) that talks to your Postgres through **Hyperdrive**.

## Deploy (about 15 minutes)

### 1. Postgres
Use any Postgres that Cloudflare can reach over the internet with TLS (Neon, Supabase, Railway, RDS…). Copy its connection string:
`postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require`

You do **not** need to create tables: the API creates them automatically on the first request. (`schema.sql` is a reference copy; you may run it yourself instead.)

### 2. Hyperdrive
Cloudflare dashboard → **Storage & databases → Hyperdrive → Create configuration** → paste the connection string. Copy the **Hyperdrive ID** and paste it into `wrangler.toml` (replace `PASTE_YOUR_HYPERDRIVE_ID`).

### 3. Put this folder on GitHub
Create a repo and push the contents of this folder (`public/`, `functions/`, `package.json`, `wrangler.toml`, …).

### 4. Create the Pages project
Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
- Framework preset: **None**
- Build command: `npm install`
- Build output directory: `public`

Deploy. (`wrangler.toml` supplies the Hyperdrive binding and the `nodejs_compat` flag.)

### 5. Add the two secrets
Project → **Settings → Variables and Secrets** → add as **Secret** (Production, and Preview if you use it):
- `APP_PASSCODE` — the passcode you will type to open MONO (make it long)
- `SESSION_SECRET` — a long random string (e.g. `openssl rand -hex 32`)

Then **redeploy** (Deployments → ⋯ → Retry deployment) so the secrets apply.

### 6. Custom URL
Project → **Custom domains → Set up a custom domain** → enter e.g. `mono.yourdomain.com`. If the domain is on Cloudflare DNS, it configures itself.

Open the URL → enter your passcode → done. On your phone use *Add to Home Screen* for an app-like icon.

## Security notes
- The API **refuses to run** unless `APP_PASSCODE` and `SESSION_SECRET` are set, so your database is never exposed by accident.
- Login sets an HttpOnly, Secure, SameSite=Strict cookie (30 days). Cross-origin writes are rejected.
- Strongly recommended extra layer: put the domain behind **Cloudflare Access** (Zero Trust, free for small teams), and/or add a WAF rate-limit rule on `/api/auth/login`.
- This is a single-user app: one passcode, one shared dataset.

## Local development (optional)
    npm install
    cp .dev.vars.example .dev.vars        # edit values
    export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://..."
    npm run dev

## Notes
- Data model: tasks, notes (rich content stored as versioned JSONB blocks), folders, countdowns. Dates are Postgres `date` and travel as `YYYY-MM-DD` strings, so there are no timezone shifts. Deleting a folder keeps its notes (`on delete set null`).
- Unlike the Android build, the web version needs a connection to load and save. A failed save shows a message and the note editor stays open, so nothing is silently lost.
- Formatting is per line (bold/italic apply to the whole line).
- Your name `$uf1` is set at the top of `public/app.js` (`USER_NAME`).
- `public/logo.png` is the provisional mascot cut-out from your showcase image; replace it with your own file of the same name.

## Not verified
Not deployed or run against a real Postgres from the build environment (no internet there). The API's login, validation, cookie and routing logic was tested against a stubbed database driver; the SQL queries and the browser UI have not been executed.
