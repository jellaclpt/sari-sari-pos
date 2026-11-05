# Sari-Sari POS

A point-of-sale system for a small sari-sari store, with separate **Admin** and **Sales Representative (cashier)** roles. Built with Node.js, Express, EJS, and PostgreSQL, and deployable to Vercel.

## Features

**Admin**
- Dashboard: revenue, orders, average order value and items sold for today / 7 days / 30 days (compared with the previous period), a sales trend chart, sales by category, top products, low-stock alerts, and today's transactions
- Products: search and filter by category group and type, sizes and colors as tags, product photos, an active toggle, edit in a side panel, delete (past sales are kept), and CSV import (download the template from the Import dialog)
- User management (create/deactivate accounts, assign roles)
- Sales: filter by date, cashier, payment method or receipt/product search; gross, refunds, net and payment split; receipt preview with print; refunds that return items to stock; CSV export
- Visibility into every inventory report submitted by cashiers

**Sales Representative (Cashier)**
- POS screen: search/scan products, build a cart, take Cash (with change), GCash or Card (with a reference no.), print a receipt
- Inventory screen: view current stock and submit reports (restock, damaged, lost, correction)

**Accounts**
- Sign in at `/login`, with an optional "Keep me signed in" (30 days instead of an 8-hour shift)
- Request access at `/request-access` — new staff send their name, preferred username, contact and role; an admin approves it from Admin ▸ Users, which creates the account with a temporary password
- Forgot password at `/forgot-password` — sends a reset request to the admin, who sets a temporary password from Admin ▸ Users
- Anyone signing in with a temporary password must choose their own before using the app

## Tech stack

- **Backend:** Node.js, Express
- **Views:** EJS (server-rendered, no build step) + vanilla JS + [Chart.js](https://www.chartjs.org/) (vendored locally in `public/js/vendor/`)
- **Database:** PostgreSQL via [`pg`](https://node-postgres.com/) — works with Vercel Postgres or any standard Postgres instance
- **Sessions:** [`cookie-session`](https://github.com/expressjs/cookie-session) — the session payload is stored directly in a signed cookie, so there's no server-side session store to manage (required for serverless deployment)
- **Deployment target:** [Vercel](https://vercel.com) (serverless functions)

## Project structure

```
api/index.js           # Vercel serverless entry point (wraps the Express app)
src/app.js             # Express app setup (middleware, routes, error handling)
src/config/db.js       # Postgres connection pool + lazy schema bootstrap
src/db/schema.sql       # Table definitions
src/db/seed.js          # Creates default accounts + sample products
src/controllers/        # Route handlers (admin, POS)
src/routes/              # Express routers (auth, admin, pos)
src/middleware/          # Auth guards, flash messages
src/views/                # EJS templates
public/                    # Static CSS/JS (served directly, no bundling)
vercel.json               # Vercel routing + function config
```

## Prerequisites

- Node.js 22.5+ (matches the `engines` field in `package.json`)
- A PostgreSQL database — any of:
  - A [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) database (same one you'll use in production)
  - A local Postgres instance (Postgres.app, Homebrew, Docker, etc.)
  - Any other hosted Postgres (Neon, Supabase, RDS, ...)

## Local installation

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Then fill in `.env`:

   | Variable | Required | Description |
   |---|---|---|
   | `PORT` | no | Local dev server port (default `3000`) |
   | `SESSION_SECRET` | yes | Any long random string — signs the session cookie |
   | `POSTGRES_URL` | yes | Postgres connection string |
   | `STORE_TIMEZONE` | no | Timezone used to group sales by day and show times (default `Asia/Manila`) |

   To point `POSTGRES_URL` at a Vercel Postgres database before it's deployed, create the database in the Vercel dashboard first (see [Deployment](#deployment-to-vercel) below), then run:

   ```bash
   vercel env pull .env
   ```

   This fills in `POSTGRES_URL` (and other Vercel-managed vars) automatically.

3. **Seed the database**

   Creates the tables (on first connection) plus two default accounts and sample products:

   ```bash
   npm run seed
   ```

   Default accounts:

   | Role | Username | Password |
   |---|---|---|
   | Admin | `admin01` | `Admin@123` |
   | Sales Rep | `cashier1` | `cashier123` |

   The admin account is also created automatically the first time the app connects to a database that has no admin yet, so you can sign in as `admin01` even without seeding.

   **Change these passwords (or re-seed with different ones) before using this with real data.**

4. **Run the app**

   ```bash
   npm run dev     # with auto-reload (nodemon)
   # or
   npm start       # plain node
   ```

   Visit `http://localhost:3000`.

## Deployment to Vercel

1. **Push the code to GitHub** (or another Git provider Vercel supports).

2. **Create a Vercel Postgres database**
   In the Vercel dashboard: your project ▸ **Storage** ▸ **Create Database** ▸ Postgres. This automatically injects `POSTGRES_URL` (and related variables) into your project's environment.

   > Already have a project imported? Add the database first, then redeploy so the function picks up the new env vars.

3. **Import the project in Vercel**
   Vercel dashboard ▸ **Add New** ▸ **Project** ▸ select the GitHub repo ▸ Deploy. No special build settings are needed — `vercel.json` already routes all traffic to the Express app in `api/index.js`, and `public/` is served as static files automatically.

4. **Set the remaining environment variables**
   In your project's **Settings ▸ Environment Variables**, add:
   - `SESSION_SECRET` — a long random string (e.g. `openssl rand -hex 32`)

   Redeploy after adding/changing env vars so they take effect.

5. **Seed the production database (first deploy only)**
   Pull the production env vars locally and run the seed script once against the real database:

   ```bash
   vercel env pull .env.production.local
   # ensure POSTGRES_URL in that file is loaded, then:
   node -r dotenv/config src/db/seed.js dotenv_config_path=.env.production.local
   ```

   If you skip seeding, the default `admin01` / `Admin@123` admin account is still created automatically on first connection — sign in and change its password right away.

6. **Visit your deployment** — Vercel gives you a `*.vercel.app` URL (or your custom domain). Sign in, and you're running.

### Notes on the serverless setup

- **Sessions** are stored entirely in a signed cookie (`cookie-session`), not server memory — this is required because serverless functions don't share memory between invocations.
- **Views** (`src/views/**`) are explicitly bundled into the function via `vercel.json`'s `includeFiles`, since Vercel's build-time file tracer can't detect EJS's dynamic `fs.readFileSync` calls on its own.
- **Database schema** is created automatically (idempotent `CREATE TABLE IF NOT EXISTS`) the first time the function queries the database after a cold start — no separate migration step needed for schema changes defined in `src/db/schema.sql`.

## Scripts reference

| Command | Description |
|---|---|
| `npm run dev` | Start the local dev server with auto-reload |
| `npm start` | Start the local server (production-style, no reload) |
| `npm run seed` | Create tables (if needed) and insert default accounts + sample products |

## License

Copyright &copy; 2026 rgrafia (SorSU). Licensed under the [MIT License](LICENSE).
