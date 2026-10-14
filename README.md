# BuildFlow

A CRM for a property/construction **sales** business: Enquiry → Follow-up → Site Visit → Negotiation → Booking → Client.
(Not a construction-execution system.)

Source of truth for design and delivery:

- [docs/BUILD-FLOW-REFERENCE-INVENTORY.md](docs/BUILD-FLOW-REFERENCE-INVENTORY.md)
- [docs/BUILD-FLOW-TECHNICAL-ARCHITECTURE.md](docs/BUILD-FLOW-TECHNICAL-ARCHITECTURE.md)
- [docs/BUILD-FLOW-IMPLEMENTATION-PLAN.md](docs/BUILD-FLOW-IMPLEMENTATION-PLAN.md)

## Layout

```
server/   TypeScript + Express + Mongoose API, plus a node-cron worker (src/worker.ts)
web/      React (JSX) + Vite SPA
docs/
```

## Prerequisites

- Node 20+ (22 recommended)
- A MongoDB **replica set** (MongoDB Atlas free tier works). A standalone `mongod` is refused at startup, because bookings need transactions.

## Run in development

```bash
npm run install:all

cp server/.env.example server/.env      # set MONGODB_URI to your Atlas connection string
npm run dev:server                      # API on :8080
npm run dev:worker                      # scheduled jobs (optional until Phase 6)
npm run dev:web                         # SPA on :5173, proxies /api to :8080
```

`server/.env` is git-ignored. Secrets only ever come from environment variables.

### First run: roles, masters, workflow and an admin user

Set `JWT_ACCESS_SECRET` (32+ chars) and, to create the first Super Admin, `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (10+ chars) in `server/.env`, then:

```bash
npm --prefix server run seed      # idempotent: roles, master values, workflow stages, admin user; never resets a password or overwrites admin edits
```

Unit photos/brochures are uploaded to Cloudinary by the server: set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` (required in production; the server refuses to start without them; in development without them uploads answer 503). The secret never reaches the browser.

Completing a site visit schedules one follow-up for the next day using the FOLLOWUP_TYPE master whose code is `POST_VISIT_FOLLOWUP_TYPE_CODE` (default `CALL`, at `POST_VISIT_FOLLOWUP_HOUR`, default 10, in `APP_TIMEZONE`); keep that type active. `SITEVISIT_REMINDER_MINUTES` sets the reminder lead time.

A unit can have only one active booking; the database enforces it with a partial unique index (`one_active_booking_per_unit`). Roles created before Phase 9 do not get `bookings.edit` / `bookings.export` automatically: grant them in the Roles UI.

Making an employee a referral uses the phone number on their user profile (it must be a valid number); roles created before Phase 10 need `referrals.archive` / `referrals.assign` granted in the Roles UI.

Business documents are stored privately in Cloudinary and served only through short-lived links the API issues after an access check (`DOCUMENT_MAX_BYTES`, `DOCUMENT_URL_TTL_SECONDS`). Roles created before Phase 11 need `documents.edit`, `documents.archive` and `whatsapp_masters.view` granted in the Roles UI. Define your document types, WhatsApp categories and WhatsApp events in Masters first (none are pre-filled). WhatsApp templates are stored only; nothing is sent.

The dashboard, reports and global search add no permissions or configuration: they use the existing `dashboard.view`, `reports.view`, `reports.export` and each resource's own `.view` permission, and always show a user only the records their role, branch and ownership allow. Dates are whole days in `APP_TIMEZONE`. CSV exports are limited to `EXPORT_MAX_ROWS` rows.

Remove `SEED_ADMIN_PASSWORD` from the environment afterwards. Behind HTTPS in production the refresh cookie is `Secure`; list your site origin in `CORS_ORIGINS` (refresh/logout reject unknown Origins).

### Upgrading an existing database

Seeds never overwrite roles an administrator may have edited, so run the data migrations after deploying a new version:

```bash
npm --prefix server run migrate        # or: migrate:prod inside the built image
```

Run `seed` first (new activity types and permissions), then `migrate`. It is idempotent and safe on every deploy. Today it carries renamed permissions over to deployed roles (`enquiries.delete` → `enquiries.archive`, `clients.delete` → `clients.archive`, `followups.delete` → `followups.archive`, `units.delete` → `units.archive`, `sitevisits.delete` → `sitevisits.archive`, `referrals.delete` → `referrals.archive`, `documents.delete` → `documents.archive`) without touching any other permission and without modifying the Super Admin wildcard role. Each changed role is written to the audit log.

## Quality gates

```bash
npm run check    # server typecheck, eslint, oxlint, all tests, both builds
```

Server tests use an in-memory MongoDB replica set (`mongodb-memory-server`; the first run downloads a `mongod` binary). No database setup is needed to run tests.

## Docker

```bash
cp server/.env.example server/.env
docker compose up --build   # api :8080, worker, web (nginx) :8081
```

MongoDB is not part of the compose file — use Atlas or your own replica set.
