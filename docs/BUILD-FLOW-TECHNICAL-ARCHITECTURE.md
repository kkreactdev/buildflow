# BuildFlow — Technical Architecture (V1)

Companion to `BUILD-FLOW-REFERENCE-INVENTORY.md`. A modular monolith: one API, one SPA, one MongoDB. No microservices.

## 1. Stack decisions

| Layer | Choice | Why / source |
|---|---|---|
| API | Node 20, **TypeScript**, Express, **zod**, **pino** | Conventions from `ORIVIL/orivil-grocy` (42 modules, ~423 tests). plot-management-node has no tests/validation. |
| DB | **MongoDB 7 as a replica set** + Mongoose 8 | Every KK-Source CRM-like project is Mongo; plot-management-node (the named backend reference) is Mongo. Replica set is *required* for the booking transaction (Atlas, or docker `--replSet`). |
| Auth | JWT access (15 min) + refresh token (httpOnly cookie or stored hash), bcrypt | Plot's JWT idea; its plaintext fallbacks dropped. |
| Files | **Cloudinary**, server-side upload | `crackers…/media` (public images) + `orivil-lms…/storage` (authenticated docs, signed URLs). |
| Jobs | `node-cron` in a separate `worker` entrypoint of the same codebase | Plot used BullMQ+Redis; V1 only needs 3–4 idempotent sweeps. Avoids a Redis dependency. Idempotency via `*NotifiedAt` fields (plot's pattern). |
| Web | React 19 + Vite + react-router + **react-query**, plain CSS, **JSX** | Lets us copy `Ivr-Version` components directly. Only new deps: none required. |
| Realtime | Poll (30 s) for notifications in V1 | Avoids socket auth issues seen in plot/IVR. |
| Tests | vitest + supertest + `mongodb-memory-server` (`MongoMemoryReplSet`) | grocy setup. |
| Deploy | Docker (api, worker, web-nginx) on a VPS; Atlas or self-hosted Mongo RS | crackers deploy docs. Not Vercel. |

New runtime deps vs. reference projects: `zod`, `pino`/`pino-http`, `node-cron`, `cloudinary`, `multer`, `helmet`, `express-rate-limit` (all already used elsewhere in KK-Source). Frontend: **none new** beyond Ivr-Version's (drop `xlsx`, `@xyflow/react`, `socket.io-client`, unused `lucide-react`).

## 2. Repository layout

```
buildflow/
  docs/
  server/
    src/
      app.ts  index.ts  worker.ts
      config/env.ts                    # zod, fail-fast
      lib/        appError asyncHandler respond logger csv counters mongoCapabilities phone
      middleware/ authenticate authorize requestContext validate errorHandler notFound rateLimit upload
      core/
        scope/        scopeResolver.ts scopedRepo.ts scopePlugin.ts   # branch isolation
        permissions/  catalog.ts (single permission list) seedRoles.ts
        workflow/     workflow.service.ts stateMachine.ts
        activity/     activity.service.ts       # timeline
        audit/        audit.service.ts          # before/after
        notify/       notification.service.ts channels/{inApp.ts}  events.ts
        storage/      cloudinary.client.ts media.service.ts documentStorage.ts
      modules/
        auth/ users/ roles/ branches/ masters/ persons/ enquiries/ followups/
        sitevisits/ clients/ units/ bookings/ referrals/ activities/ documents/
        notifications/ dashboard/ reports/ search/ whatsappMasters/
        (each: routes.ts controller.ts service.ts schema.ts model.ts *.test.ts)
      jobs/ missedFollowups.ts upcomingFollowups.ts
      seeds/ masters.ts roles.ts workflow.ts demo.ts
      test/ setupTestDb.ts
    Dockerfile  package.json  tsconfig.json  vitest.config.ts  .env.example
  web/
    src/
      app/        App providers router guards
      api/        http.js queryKeys.js (+ one thin file per module)
      hooks/      useAuth usePermissions useMasters useTableState ...
      components/ ui/ (Ivr-Version + crackers kit)  charts/  data/(DataTable, FilterBar, Timeline, MasterBadge, FileUploader)
      features/   dashboard enquiries kanban sitevisits followups clients units referrals activities documents notifications reports masters admin(users,roles,branches)
      lib/ format.js csv.js
      styles/ tokens.css global.css
    index.html vite.config.js package.json
  docker-compose.yml  README.md
```

Rules: controllers are thin (parse → service → respond); services hold business logic; **no business logic in React components**; every module < ~400 lines per file.

## 3. API conventions

- REST, JSON, prefix `/api/v1`. `GET /enquiries?search=&status=&branchId=&assignedTo=&from=&to=&sort=-createdAt&page=1&limit=25`, `POST`, `PATCH /:id`, `DELETE /:id` (= archive). Actions as sub-resources: `POST /enquiries/:id/transition`, `/assign`, `/convert`, `/lose`, `/reopen`.
- Envelope: `{ data, meta:{page,limit,total} }` / `{ error:{code,message,details} }` (grolynk `respond.ts`).
- Every route: `authenticate → authorize('perm.key') → validate(zod) → controller`. A route without `authorize` fails a lint-style unit test that walks the router.
- Errors: `AppError(status, code)`; 409 for transition/booking conflicts; request id on every log line.

## 4. RBAC (reusable authorization layer)

**Permission catalog** (`core/permissions/catalog.ts`) is the single source: `{resource}.{action}` strings, e.g.
`enquiries.view|create|edit|delete|assign|export|convert|revert|lose|reopen`, `followups.*`, `sitevisits.*`, `clients.*`, `units.view|create|edit|delete|assign|book|release|manage_media`, `bookings.create|resolve_conflict|release`, `referrals.*`, `documents.view|upload|delete`, `activities.view`, `reports.view|export`, `dashboard.view`, `masters.view|manage`, `users.manage`, `roles.manage`, `branches.manage`, `notifications.view`, `whatsapp_masters.manage`.
`GET /auth/permissions-catalog` feeds the role editor; the UI never hard-codes the list.

**Role** document: `{ name, key, permissions: string[], dataScope: 'ALL'|'BRANCH'|'OWN', isSystem }`.
Seeded system roles (editable permissions, non-deletable): Super Admin (`*`, scope ALL), Admin (all except `roles.manage`/`branches.manage` configurable, ALL), Manager (BRANCH), Sales Executive (OWN within branch). Code checks **permission keys only** — never role names. (`*` is expanded server-side at token build; Super Admin is just a role holding every key.)

**User**: `{ roleId, branchIds[], primaryBranchId }`. Optional per-user `grants[]/denies[]` (from plot's `UserRights` idea) — *defer unless needed*.

**Principal** (built per request from the DB role, not trusted from the JWT body beyond `userId`): `{ userId, permissions:Set, dataScope, branchIds, isAll }`. Role changes take effect on next request (cache per request only).

**Frontend**: `usePermissions().can('enquiries.assign')` and `<Can perm="...">`; route guard in the router config. Purely cosmetic — backend authorizes independently. Permissions come from `GET /auth/me`; **fail closed** while loading.

## 5. Branch isolation (backend/data-access level)

1. `branchId` is a required, indexed field on: Enquiry, Client(branchIds[]), Unit, SiteVisit, FollowUp, Referral, Document, Activity, Notification, Booking, plus report queries.
2. `scopeResolver(principal, resource)` → Mongo filter: ALL → `{}` (optionally narrowed by `?branchId`); BRANCH → `{branchId:{$in: principal.branchIds}}`; OWN → branch filter **and** `{assignedTo: userId}` (or `createdBy`) for assignable resources.
3. All reads/writes go through `scopedRepo(Model, principal)` which injects the filter into `find/findOne/count/aggregate($match first)/update/delete`. Direct `Model.find` on scoped models is blocked by a **Mongoose query middleware plugin** that throws unless the query carries a scope marker or `.unscoped()` (explicit, grep-able; used only by jobs/seeds). A unit test per module asserts a Branch-A manager gets 404 on a Branch-B id and zero rows on lists.
4. Writes: the branch of a new record is derived from the principal (or validated ∈ principal.branchIds); `branchId` in the body is never trusted blindly.
5. Cross-branch client: `Client.branchIds[]`; a client is visible if any of its branches is in scope. The linked Person/identity record is branch-less, but only reachable through scoped Enquiry/Client records, except the **duplicate-check endpoint**, which returns a minimal match (name masked phone, branch name, id) so a user can request a link without leaking full data; linking across branches requires `clients.link`.
6. Dashboard/report aggregations use the same `scopeResolver` as their first `$match`.

## 6. Data model (MongoDB)

All business docs: `createdAt, updatedAt, createdBy, updatedBy, isArchived(false), archivedAt, archivedBy`; default queries filter `isArchived:false` (partial indexes where uniqueness matters). `*Id` are ObjectIds. Display IDs via atomic counters (`ENQ-2026-00042`) using `core/counters` (+ format/reset from grocy `documentNumbers`).

| Collection | Key fields | Indexes (besides `_id`) |
|---|---|---|
| `branches` | name, code, address, isActive | unique `code` |
| `users` | name, email, phone, passwordHash, roleId, branchIds[], primaryBranchId, isActive, lastLoginAt | unique `email`; `branchIds` |
| `roles` | name, key, permissions[], dataScope, isSystem | unique `key` |
| `masters` | `type`, `code`, `label`, `color`, `sortOrder`, `isActive`, `systemKey?` (protected semantic key), `meta{}`, `branchId?` | unique `(type, code)`; `(type, sortOrder)` |
| `workflowStages` | `code` (e.g. NEW), `label`, `order`, `systemKey` (immutable: one of the 9 canonical or `LOST`), `isTerminal`, `kind: 'OPEN'|'LOST'|'CONVERTED'`, `color`, `isActive` | unique `code`; `order` |
| `persons` | name, `phoneE164` (normalized), `altPhones[]`, email, address, city | **unique `phoneE164`** |
| `enquiries` | `enquiryNo`, personId, branchId, sourceId, typeId, preferredLocationId, propertyTypeId, buildingTypeId, interestedUnitIds[], assignedTo, **stageCode**, stageChangedAt, lostReasonId, lostNote, referralId?, clientId?, nextFollowUpAt (denormalized), notes | `(branchId, stageCode, createdAt)`; `(assignedTo, stageCode)`; `personId`; text/prefix on name/phone/no; `nextFollowUpAt` |
| `enquiryStageHistory` | enquiryId, from, to, direction (FWD/BACK/LOST/REOPEN), reason, by, at | `enquiryId` |
| `clients` | `clientNo`, personId (**unique**), branchIds[], categoryId, convertedFromEnquiryIds[], notes | unique `personId`; `branchIds` |
| `followups` | enquiryId, personId, branchId, assignedTo, typeId, statusId, scheduledAt, completedAt, outcome, notes, `missedNotifiedAt`, `upcomingNotifiedAt`, `autoCreatedFrom?` (siteVisitId) | `(branchId, scheduledAt)`; `(assignedTo, scheduledAt)`; `enquiryId` |
| `sitevisits` | enquiryId, personId, branchId, assignedTo, visitAt, statusId, unitIds[], feedback, notes, location{text,lat,lng}, `reminderSentAt`, `postVisitFollowupCreated` | `(branchId, visitAt)`; `enquiryId`; `unitIds` |
| `units` | `unitCode`, name, propertyTypeId, buildingTypeId, locationId, address, lat, lng, price, **statusId** (+`statusKey` denorm: AVAILABLE/BOOKED/SOLD/HOLD…), assignedTo, branchId, description, media[{kind,publicId,url,order}], `version` | unique `(branchId, unitCode)`; `(branchId, statusKey)`; `assignedTo` |
| `unitAssignments` | unitId, fromUser, toUser, by, at, reason | `unitId` |
| `bookings` | unitId, enquiryId, clientId/personId, salespersonId, branchId, bookingDate, amount, status `ACTIVE|RELEASED|CANCELLED`, releasedBy/At/reason | **unique partial `{unitId}` where `status:'ACTIVE'`**; `branchId` |
| `bookingConflicts` | unitId, existingBookingId, attemptedBy, attemptedEnquiryId, branchId, status `OPEN|RESOLVED`, resolvedBy/At/resolution | `(branchId,status)` |
| `referrals` | typeId (Client/Employee/External), referrerPersonId, referrerClientId?, referrerUserId?, branchId, status, notes, enquiryIds[], convertedAt | `referrerPersonId`; `branchId` |
| `documents` | entityType, entityId, branchId, documentTypeId, name, cloudinary{publicId,resourceType,deliveryType,format,bytes,url?}, uploadedBy | `(entityType,entityId)` |
| `activities` | type (master code), description, userId, at, branchId, **refs[{type,id}]**, metadata | multikey `refs.type+refs.id`+`at:-1`; `(branchId, at)` |
| `auditLogs` | entityType, entityId, action, before, after, userId, branchId, reason, at, requestId | `(entityType, entityId, at)` |
| `notifications` | userId, branchId, eventCode, title, body, refs, readAt, channel, dedupeKey | `(userId, readAt, createdAt)`; unique sparse `dedupeKey` |
| `whatsappCategories/Events/Templates` | (stored in `masters` with types `WA_CATEGORY`,`WA_EVENT`) templates: categoryId, eventId, name, body, `variables[]` (keys from controlled list) , status, isActive | unique `(eventId,name)` |
| `counters` | key, seq | unique key |

**Masters (all dropdowns):** one `masters` collection, one generic module, one registry in code `masterTypes.ts` listing each `type`, its label, and whether it's branch-scoped and which fields it accepts. Types: `ENQUIRY_SOURCE, ENQUIRY_TYPE, PROPERTY_TYPE, BUILDING_TYPE, UNIT_STATUS, LOCATION, FOLLOWUP_TYPE, FOLLOWUP_STATUS, SITEVISIT_STATUS, CLIENT_CATEGORY, REFERRAL_TYPE, DOCUMENT_TYPE, MEDIA_TYPE, LOST_REASON, ACTIVITY_TYPE, WA_CATEGORY, WA_EVENT`. Branches, Users, Roles, Permissions, WhatsApp Templates and **Enquiry Statuses (= workflowStages)** have their own collections/UIs because they carry structure. Frontend gets everything via `GET /masters?types=a,b,c` cached by react-query; zero hard-coded dropdown values. Masters with `systemKey` (e.g. follow-up status `COMPLETED`/`PENDING`, unit status `AVAILABLE/BOOKED/SOLD`, site-visit status `COMPLETED`) are the only values code may reference, always by `systemKey`, never by label/name or `_id`; those rows can be relabelled/recoloured but not deleted or re-keyed.

## 7. Enquiry workflow (state machine)

Configured in `workflowStages` (admin UI: reorder/rename/recolor/add optional stages between canonical ones). Canonical seed: `NEW → CONTACTED → INTERESTED → SITE_VISIT_SCHEDULED → SITE_VISIT_COMPLETED → NEGOTIATION → BOOKED → CONVERTED`; `LOST` is a controlled state (`kind:'LOST'`).

`workflow.service.transition(enquiryId, toCode, {reason}, principal)`:
1. Load enquiry in scope (404 otherwise); load active stages ordered.
2. **Forward**: `to` must be exactly the next active, non-LOST stage after current → else 409 `STAGE_SKIP`. Requires `enquiries.edit`.
3. **Backward** (to.order < from.order): requires `enquiries.revert` (granted to Manager/Admin) + non-empty `reason` → else 403/422; writes history `BACK`.
4. **LOST**: from any open stage; requires `enquiries.lose`, `lostReasonId` (master) required. **Reopen** from LOST: `enquiries.reopen`, returns to a chosen earlier open stage (default NEW) with reason.
5. Terminal `CONVERTED` is reached only via the conversion flow (§8) or an automatic transition from BOOKED if configured; no moves out except Admin revert w/ reason.
6. Guards (side-effect preconditions by `systemKey`): `SITE_VISIT_SCHEDULED` requires an existing scheduled SiteVisit (created together via the schedule action, not a bare drag); `SITE_VISIT_COMPLETED` is set by completing the visit; `BOOKED` is set only by the booking service; `CONVERTED` only by convert. A Kanban drop onto a guarded stage opens the same form (schedule visit / booking) rather than failing silently.
7. Atomic write: `findOneAndUpdate({_id, stageCode: from}, {stageCode: to, ...})` — concurrent moves → one wins, the other gets 409. Then in the same transaction: stage history, activity, audit, notification.
8. Kanban, list actions, bulk actions and API all call this one function. The funnel query orders by `workflowStages.order`, so it follows configuration.

Stage `systemKey`s are the contract between config and code; admins may add intermediate stages (`systemKey:null`, treated as plain forward steps).

## 8. Person identity & conversion

- `phoneE164` normalized by `lib/phone.ts` (strip, default country from config, store `+91…`), unique on `persons`. Creating an enquiry: `PersonService.findOrPrepare(phone)`:
  - no match → create Person.
  - match → API returns `409 POSSIBLE_DUPLICATE {person, enquiries(in scope), client?}`; the UI shows the existing record; an authorized user re-submits with `linkPersonId` (permission `persons.link`) to attach a new enquiry to the existing person. Link is recorded as an Activity + AuditLog. No silent duplicate persons (unique index backstops the race).
- Convert enquiry → client (`enquiries.convert`): manual button, or **status-based** (setting stage `CONVERTED`, or `BOOKED` if configured via `workflowSettings.convertOnStage`) runs the same `clientService.convertFromEnquiry`: finds Client by `personId`; if absent, creates one; else adds the enquiry's branch to `branchIds` and the enquiry to `convertedFromEnquiryIds`. Same duplicate/confirm UX when a *different* person record seems to match (e.g. alt phone). Writes Activity + Audit.
- Referral conversion: `POST /referrals` from an existing client/user: `referrerPersonId` = that client's/employee's person (no re-entry). Employees get a Person record created lazily from the user's phone.

## 9. Follow-ups, site visits, jobs

- One `followups` collection. "Today" = `scheduledAt` in [today 00:00, 24:00) in the configured TZ and status not terminal; "Missed" = `scheduledAt < now` and status's `systemKey ∈ {PENDING,RESCHEDULED}` — computed in queries, never stored.
- Site visit completion (`sitevisits.complete`) → in the transaction: visit status→COMPLETED systemKey, enquiry stage→`SITE_VISIT_COMPLETED`, **creates one follow-up for next day** (`autoCreatedFrom=siteVisitId`, idempotent via `postVisitFollowupCreated`). Completing a follow-up creates nothing.
- Jobs (worker, every 5–15 min, TZ from config): `missedFollowups` (notify assignee + manager once, set `missedNotifiedAt`), `upcomingFollowups` (notify N min before, `upcomingNotifiedAt`), `siteVisitReminders`. Each is idempotent so double-runs and restarts are safe. Worker runs with `.unscoped()` explicitly.

## 10. Units, assignment, booking

- Unit status master with `systemKey` AVAILABLE/HOLD/BOOKED/SOLD (extensible). `Unit.assignedTo` single current owner; reassign = `POST /units/:id/assign` → `unitAssignments` history + activity.
- **Booking** `POST /bookings`: in `withTransaction`:
  1. `Unit.findOneAndUpdate({_id, branchId, statusKey:'AVAILABLE'|'HOLD(by same enquiry)', version}, {statusKey:'BOOKED', $inc:{version:1}})`.
  2. `Booking.create(... status:'ACTIVE')` — protected by the **partial unique index on `unitId`** (ACTIVE).
  3. Enquiry stage → `BOOKED`, activity, audit, notification to manager.
  If (1) returns null or (2) throws duplicate-key (E11000): abort, create a `bookingConflict` (open) with attempted user/enquiry, notify the branch Manager(s), return **409 `BOOKING_CONFLICT`** with the existing booking summary. Nothing is overwritten. Manager resolves via `POST /booking-conflicts/:id/resolve` (`bookings.resolve_conflict`): keep existing, or release existing (reason) and re-run the booking for the challenger.
- **Release** `POST /bookings/:id/release` (`bookings.release`; Manager+): reason required; booking→RELEASED, unit→AVAILABLE, activity+audit.
- Boot check `mongoCapabilities`: refuse to start (production) if Mongo is standalone.

## 11. Activities & audit

- `activity.service.record({type, description, userId, branchId, refs:[{type:'enquiry',id},{type:'unit',id}…], metadata})`: one write, appears on every referenced entity's timeline (`GET /activities?refType=unit&refId=…`). Example "Raj Kumar visited Villa 03" refs both the person/client, enquiry, site visit and the unit. Activity `type` is a master (`ACTIVITY_TYPE`) keyed by `systemKey`. Business events call it from services (stage change, assignment, visit complete, booking, release, document upload, convert, link, referral…). Failures inside a transaction roll back with it; outside transactions it is best-effort and logged.
- `audit.service.record({entityType, entityId, action, before, after, reason})` called by a `withAudit` service helper that diffs on update; sensitive fields redacted. Soft delete = `isArchived` (+ audit); hard delete not exposed.

## 12. Documents & media (Cloudinary)

- `storage/cloudinary.client.ts` is the only file importing the SDK (provider interface + mock driver for tests, copied from crackers). Env zod requires Cloudinary credentials in production.
- Unit **media** (public): front/exterior/interior/floor plan/brochure/other via `MEDIA_TYPE` master; stored in `units.media[]` (publicId, url, kind, order). Replace = upload new → persist → delete old (rollback on failure). Magic-byte check, SVG refused, 5–10 MB cap.
- **Documents** (private, any entity): `documents` collection with `entityType/entityId/branchId/documentTypeId` and Cloudinary asset info; delivery `authenticated`, short-lived signed URL generated per request after a scoped permission check (`documents.view`), never stored. Upload requires `documents.upload`. Allowed mime list in config. Orphan cleanup job for uploaded-but-unpersisted assets.

## 13. Notifications

`notification.service.notify(eventCode, recipients[], payload)` → persists `notifications` (with `dedupeKey`) then fans out to `channels[]`. V1 registers only `InAppChannel`; interface `NotificationChannel { send(notification, user) }` allows email/push/WhatsApp later with no schema change. Events: follow-up missed/upcoming, assignment, site visit scheduled/reminder, booking created/conflict/released, key stage changes (BOOKED, LOST, CONVERTED). Event→recipient rules live in code (`events.ts`), with per-event enable toggle in masters (`meta.enabled`).

## 14. WhatsApp (master-only)

Masters: `WA_CATEGORY`, `WA_EVENT` (generic masters) and `whatsappTemplates` (own module): `{name, categoryId, eventId, body, variables[], status, isActive}`. `variables` must be a subset of a **code-defined allow-list** (`{{client_name}}, {{enquiry_no}}, {{unit_name}}, {{unit_location_url}}, {{unit_price}}, {{visit_datetime}}, {{branch_name}}, {{employee_name}}`, …). `body` is validated: only `{{allowed}}` tokens, each declared. `unit_location_url` is a deliberate hook for later "exact location share" (units already store lat/lng). No sending, no provider code.

## 15. Dashboard, reports, search, export

- `GET /dashboard/summary?branchId&from&to&assignedTo&sourceId&propertyTypeId&buildingTypeId` returns KPIs via aggregations (scoped `$match` first): new/active enquiries, today's & missed follow-ups, site visits, available/booked units, converted clients, **funnel** (`$group` by stageCode joined to `workflowStages` order — "reached stage" computed from `enquiryStageHistory`), sales performance (by assignee), source performance. Previous-period comparison via plot's `rangeWindow()` idea. No in-memory loading of collections.
- Global search: `GET /search?q=` across persons/enquiries/clients/units (prefix on phone/enquiryNo/unitCode/name, scoped per resource and gated by view permission), returns top N per type.
- List endpoints share `lib/listQuery.ts` (parse page/limit/sort/filters, whitelist sortable fields, cap limit at 100).
- Export: `GET /<resource>/export.csv` with the same filters; permission `<resource>.export`; scoped; streamed; UTF-8 BOM; audit entry. CSV only in V1; no import.

## 16. Frontend architecture

- Router with lazy routes and `permission` metadata; sidebar generated from the same route table filtered by `can()`.
- `api/http.js` REST client (token, 401→logout, `ApiError` with `code/details`); one thin module per backend module; `queryKeys.js` factory.
- Generic `DataTable` + `useTableState` (URL-synced query params), `FilterBar` (filters declared as config, options from masters), `MasterSelect` (reads `useMasters(type)`), `MasterBadge`, `Timeline`, `FileUploader`, `ConfirmDialog` (async-aware).
- Enquiries page: List / Kanban toggle sharing one filter state. Kanban columns = `workflowStages`; a drop calls `POST /enquiries/:id/transition`; guarded stages open the corresponding dialog; errors toast the server message and the card snaps back (no optimistic state).
- Responsive: tables → card lists < 640 px; sidebar → drawer; Kanban horizontal scroll with "Move to…" menu for touch.

## 17. Security & ops

helmet, CORS from env list, login + refresh rate limiting, password policy, refresh rotation, no debug routes, no secrets in repo (`.env.example` committed, real `.env` ignored), upload size/type limits, request ids, pino redaction of tokens/phones where logged, Dockerfiles non-root, `/health` and `/ready` (DB ping) endpoints. **Rotate** any credentials found hard-coded in the reference repos before anyone reuses them.

## 18. Testing strategy

Per module: service tests + supertest route tests against `MongoMemoryReplSet`. Mandatory suites: (a) permission matrix — every route denies a user lacking its key; (b) branch isolation — cross-branch read/write/list/export/dashboard all denied; (c) workflow — forward-only, skip rejected, backward needs permission+reason, LOST/reopen, concurrent moves; (d) booking — concurrent double-book yields exactly one ACTIVE booking and one conflict record, release; (e) duplicate person/link/convert; (f) post-visit follow-up created once; (g) jobs idempotency; (h) masters-driven validation (inactive master value rejected). Web: vitest for hooks/util + a few component tests; Playwright smoke later (crackers pattern).

## 19. Out of scope for V1

BOQ/estimation/materials/contractors/scheduling/execution; WhatsApp sending; payments/commission; import; microservices; realtime sockets; multi-company (single company, `Company` settings document only).
