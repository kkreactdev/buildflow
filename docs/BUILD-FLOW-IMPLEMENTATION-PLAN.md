# BuildFlow — Implementation Plan (V1)

Each phase is independently shippable and ends green (tests + lint). Backend and its UI land together per phase so every phase is demoable. Paths: `server/src/...`, `web/src/...` (see Architecture §2). "Ref" points to the reuse source in the Inventory.

Order rationale: foundation → access control → masters → people → enquiry workflow → follow-ups/visits → units/booking → referrals/docs → dashboard → hardening. RBAC, branch scope and masters come before any business module so no module is ever built unscoped or with hard-coded dropdowns.

Assumptions (see "Decisions" in the report): MongoDB replica set, TS API, JSX web, Cloudinary account available, VPS/Docker deploy.

---

## Progress

| Phase | Status |
|---|---|
| 0 Scaffold & tooling | **Done** (see "Phase 0 result" below) |
| 1 Auth, users, roles, permission layer | **Done** (see "Phase 1 result" below) |
| 2 Branch isolation / scope layer | **Done** (see "Phase 2 result" below) |
| 3 Masters, workflow config, activity/audit | **Done** (see "Phase 3 result" below) |
| 4 Persons + Clients | **Done** (see "Phase 4 result" below) |
| 5 Enquiries, assignment, workflow, Kanban | **Done** (see "Phase 5 result" below) |
| 6 Follow-ups + notifications | **Done** (see "Phase 6 result" below) |
| 7 Units / properties + media | **Done** (see "Phase 7 result" below) |
| 8 Site visits | **Done** (see "Phase 8 result" below) |
| 9 Booking, conflicts, release | **Done** (see "Phase 9 result" below) |
| 10 Referrals | **Done** (see "Phase 10 result" below) |
| 11 Documents + WhatsApp templates | **Done** (see "Phase 11 result" below) |
| 12 Dashboard, reports, global search | **Done** (see "Phase 12 result" below) |
| 13 | Not started |

### Phase 0 result and deviations from the architecture doc
Delivered: server (TS/Express 5/Mongoose/zod/pino) with env validation, DB connection + transaction-capability detection, `withTransaction` that refuses to run on non-replica-set deployments, error/validation/response conventions, health + readiness, node-cron worker skeleton, permission catalog + fail-closed `authorize()`, branch `resolveScope`, activity + audit models/services; web (React 19/Vite) with theme tokens, ported UI primitives, REST client, query-key factory, auth boundary placeholder, permission-aware shell/router (module registry), DataTable/FilterBar/SearchInput/QueryState/ActionMenu/EmptyState/ConfirmDialog, `useTableState`/`useForm`; Dockerfiles + compose; README.

Deviations / clarifications (the docs above remain the source of truth otherwise):
1. **Express 5** (not 4): async handler rejections reach the error handler natively, so there is no `asyncHandler` wrapper.
2. **Server code lives in `server/src/`** (`core/ modules/ jobs/ seeds/ test/` under `src/`).
3. **Activity and Audit models + services were pulled forward into Phase 0** (they are infrastructure every later phase needs). Phase 3 therefore only adds the read APIs (`GET /activities`, `GET /audit`), the ACTIVITY_TYPE master validation, and UI.
4. **Audit shape**: stores `changes: { field: { from, to } }` (+ who/branch/reason/requestId/at) instead of separate `before`/`after` snapshots; sensitive fields are redacted.
5. **Branch isolation**: `scopeResolver` + `assertBranchWritable` exist and are unit-tested; the **Mongoose scope plugin and `scopedRepo` remain Phase 2** (where they get their first real model).
6. **`Principal` is defined but nothing populates it yet**: `authenticate` arrives in Phase 1. Until then `authorize()` answers 401 on every route (fail-closed), and the only public routes are `/health` and `/ready` (declared with `publicRoute`).
7. **Frontend is JSX**, so there is no TypeScript typecheck for it: its gates are `vite build` + oxlint + vitest. The shared zod schemas package was not created (as planned in the architecture).
8. **Web dev-only features** (compiled out of production builds): login-page "Preview as…" fake session and `/dev/components` gallery. They exist only so the shell can be viewed before Phase 1; they grant nothing on the server.
9. Charts ported so far: Sparkline, DonutChart, TrendChart, RangeMeter (+ `scale.js`). FunnelChart/SourceBar are deliberately **not** ported yet (IVR versions are coupled to lead statuses); they are adapted in Phase 12.
10. `icons.jsx` still contains IVR-only icons (WhatsApp, dialer, etc.); prune opportunistically.

Carry-over to Phase 1: add a real `.env`-driven JWT config (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, TTLs) to `config/env.ts`; add `express-rate-limit` for login; add a router-walking test that every non-public route declares `authorize` (no routes exist yet to walk).

### Phase 5 result and deviations
Delivered: identity-lookup rate limiting (separate hardening commit), the Enquiry module (CRUD, search, board, export, assignment with history, stage transitions, lost/reopen, archive), Kanban + list + detail UI. Tests: server 459 (+87), web 124 (+27); typecheck, eslint, oxlint, builds and Docker builds clean.

**Hardening first — identity rate limit.** `identityLimiter` throttles the endpoints through which a full phone number can reveal "already registered elsewhere": `persons.lookup`, person create/edit/link, client create and enquiry create. Keyed by authenticated user + IP (IPv6-safe), applied *after* authorization (unauthenticated/unauthorized callers never consume or probe), generic 429 with `Retry-After`, no phone in logs, hidden-match audit unchanged. Configurable: `IDENTITY_RATE_LIMIT_MAX` (default 30) per `IDENTITY_RATE_LIMIT_WINDOW_SECONDS` (default 60). In-memory per instance like the login limiter (use a shared store if the API is scaled out).

**Enquiry model.** `Enquiry` (branch-scoped; `ownerField: assignedTo`, so OWN scope sees only assigned enquiries), human id `ENQ-000042` from the atomic counter (unique, never reused, gaps possible), `personId` (identity stays on Person; `personName`/`phoneE164` are a search projection kept in sync on identity change, extending the Phase 4 sync to enquiries), master references (source, type, property type, building type, location), `stageCode` (workflow `systemKey`), `lostReasonId` (set only while LOST), `assignedTo`, notes, soft-delete. Two append-only, scoped collections: `enquiryStageHistory` (every move, incl. the initial CREATE entry the funnel will read) and `enquiryAssignments`. No second status master: stages are the Phase 3 workflow.
- **Creation** validates branch, every master (ACTIVE, right type; **LOCATION must belong to the enquiry's branch**, also for ALL-scope actors), the assignee (active user of the branch; OWN users only themselves), then in ONE transaction: person (new or attached via the shared `preparePerson`/`materializePerson`, so duplicates are reported exactly like clients: 409 `PERSON_EXISTS`, existence-only across branches, `personId` = explicit "use this person"), enquiry, initial history, optional assignment row, audit, `ENQUIRY_CREATED` activity (refs enquiry + person). New enquiries start at the first active workflow stage.
- **Update** accepts descriptive fields only (masters + notes). Stage/status, owner, branch, person, number, lost reason are rejected (strict schema) so a generic update can never bypass a controlled operation. An unchanged inactive master stays valid; choosing an inactive one does not.
- **Master reference checkers** registered for all six types (`ENQUIRY_SOURCE`, `ENQUIRY_TYPE`, `PROPERTY_TYPE`, `BUILDING_TYPE`, `LOCATION`, `LOST_REASON`; lost reasons also count via the stage history). Archived enquiries and other branches count; unused values are now deletable; used ones stay `IN_USE`; deactivation stays allowed and history still displays.
- Fields not built (not in this phase): unit/property interest (Phase 7), follow-up info (Phase 6), referral source (Phase 10), client conversion (kept as a later controlled operation; creating an enquiry for a person who is already a client neither creates nor changes a client).
- **Master fields are optional.** Requiring a source/type would block creation on a fresh install before administrators configure masters; make a field required later by validating it in `createEnquiry`.

**Assignment.** `POST /enquiries/:id/assign` (`enquiries.assign`): the assignee must be an active user of the enquiry's branch whom the actor can see (shared `validateAssignee`, now also used by clients); OWN-scope holders can only take things for themselves; reassigning requires a reason; no-ops are refused; the write is conditional on the previous owner so simultaneous assignments cannot both win (`ASSIGNMENT_CHANGED`). Each change adds an `enquiryAssignments` row (from, to, by, reason, branch, time), an audit entry and an `ENQUIRY_ASSIGNED` activity. History is branch-scoped.

**Workflow integration.** One endpoint changes stage: `POST /enquiries/:id/transition {to, from?, reason?, lostReasonId?}` plus `/lose` and `/reopen` conveniences that force their direction. All use the Phase 3 `WorkflowDefinition.plan` (no skipping, forward `enquiries.edit`, backward `enquiries.revert`+reason, lost `enquiries.lose`+Lost Reason, reopen `enquiries.reopen`+reason+MANUAL target, domain-only stages → 409 `DOMAIN_ONLY` with the owning operation). The route guard is only `enquiries.view`; the state machine applies the direction-specific permission (so a role holding only `revert` can still revert). Persistence is compare-and-set on the stage the rules were evaluated against (`STAGE_CHANGED` 409 on a race) and the history row, audit entry (`transition`/`revert`/`lost`/`reopen`) and activity commit together. `from` lets a stale screen be told it is stale. A malicious `{status: …}` body is a 400 on every endpoint. Workflow rule added: **a CONVERTED enquiry cannot be marked lost** (`TERMINAL_STAGE`).

**Kanban.** Columns come from `GET /enquiries/board` (one scoped aggregate for counts + a page of cards per stage, ordered by the workflow; a deactivated stage stays visible while it holds enquiries). Dragging fetches `GET /workflow/transitions?from=` and offers only those columns (domain-owned stages are flagged and explain their owning action instead of moving); invalid drops never reach the server; reasons (backward/reopen) and Lost Reason (master) are collected in a dialog first; the card is only marked busy while the request runs and **never moves until the server confirms**; a refusal keeps the card in place and shows the server's message. A "Move to…" menu offers the same backend-driven moves for keyboard/touch. The IVR deals board was the layout/interaction reference; none of its hard-coded stage logic was used.

**List / search / export.** Server-side pagination (max 100), sorting, and filters (stage(s), source, type, property type, building type, location, assignee incl. unassigned, person, branch, created range, archived). Search matches enquiry ID (prefix or number), name and phone in any notation (a full number typed with a trunk `0` now matches; clients benefit too). CSV export (`enquiries.export`) uses the same scoped repository and filters, refuses results above `EXPORT_MAX_ROWS` (default 20,000) before sending any byte, neutralises spreadsheet formulas, writes an audit entry, and emits phones without the leading `+` (header "Phone (with country code)") so they are not treated as formulas.

**Timeline/audit/RBAC.** `registerRefAuthorizer('enquiry', …)`; new activity types `ENQUIRY_UPDATED|LOST|REOPENED|ARCHIVED`. Audit actions: create, update, assign, transition, revert, lost, reopen, archive, export. Permission `enquiries.delete` was renamed **`enquiries.archive`**; `convert` remains for the later conversion phase. Existing databases keep old role definitions: add `enquiries.archive` to roles in the Roles UI.

**Dashboard preparation.** `stageCounts` (scoped aggregate), the history collection and indexes on branch/stage/assignee/master fields are in place; no dashboard was built.

Deviations / notes:
1. Enquiry master fields are optional (above).
2. `/transition` is guarded by `enquiries.view` + the state machine instead of a single fixed permission, by design.
3. The detail page shows audit history only to `audit.view` holders; user names in history come from the scoped user lookup, so an OWN-scope user may see ids as blank names for colleagues they cannot see.
4. The board loads a fixed page per column ("N more — view in list"); there is no infinite scroll.
5. Enquiry numbers share the counter infrastructure; they are not branch-prefixed.

### Unified Units (enquiries and clients)
One engine (`unitInterests/unitRelations.ts`) resolves a unit's relationship for an enquiry, or for a client through ALL of its enquiries, and is used by the Enquiries list, the Clients list and both detail pages, so the same relationship shows everywhere. **One entry per unit**; `state` (strongest real fact): Sold (unit Sold AND this party holds its ACTIVE booking, with purchaser, source enquiry and booking) > Booked > Not interested > Site visit completed > Site visit planned > Interested > Booking released; the unit's inventory status, the enquiry stage and each booking's status stay separate fields. Only Interested / Not interested are recorded by hand (`POST /enquiries/:id/unit-interests` with `{ unitId, status, note }`; one record per enquiry + unit, switching state reuses it, a repeat of the same state is 409). Booked goes through the booking service ("Book unit…" opens the booking form); Sold is never set from here and never guessed. **Hold is deliberately not offered**: it would be an inventory reservation and needs rules that do not exist (who may hold, how long, automatic expiry/release, what a booking does to a hold); until they are decided a unit can only carry the administrator-defined "On hold" inventory status. List endpoints add a compact `units` array per row (omitted without `units.view`); detail endpoints add `units` (null without `units.view`).

### Relationship model and unit interest (added after Phase 12)
**Canonical rule:** a client is a person in a branch (`personId` + `branchId`, unique). Everything is reached through that identity, not through a client id that older records may lack: a client's enquiries are the person's enquiries in the branch; their follow-ups and site visits are those with `clientId` OR an `enquiryId` of those enquiries; their bookings are the bookings of that person in the branch (the booking view now resolves `clientId` / `clientNo` itself when the booking pre-dates the client); their units come from bookings (active, released, sold-to-client), unit interest, and site-visit units. `GET /clients/:id/related` returns these sections, each read with the caller's own scope and permission (`null` = not permitted, which differs from empty). **Unit interest** is a new `UnitInterest` record (`enquiryId` + `unitId`, unique; `INTERESTED` / `WITHDRAWN` stored, progress derived: site visit planned/completed, booked, booking released) with `POST/GET /enquiries/:id/unit-interests`, `POST /unit-interests/:id/withdraw`, `GET /units/:id/unit-interests`; it changes no enquiry stage, unit status or booking. Unit detail adds `interests` and `sale` (`LINKED` through the unit's ACTIVE booking, `UNLINKED` for a Sold unit with none, never guessed). Re-run `npm run seed` after deploying so the activity types `UNIT_INTEREST_ADDED/WITHDRAWN` exist. `npm run reconcile` prints a read-only relationship report.

### Enquiry conversion (added after Phase 12)
`POST /enquiries/:id/convert` (permissions `enquiries.convert` AND `clients.create`; optional body `{ categoryId?, notes? }`). It was scaffolded in Phase 3/5 (the CONVERTED domain stage, the permission, the CLIENT_CONVERTED activity type) but never implemented, which is why no button existed. Now: only from the stage just before Converted (Booked, found from the workflow), never for lost or archived enquiries; in ONE transaction it creates the client, or links the person's existing client in the enquiry's branch (a person is a client of a branch once, by unique index; a race links instead of duplicating), moves the enquiry to Converted through the domain operation (history, audit `convert`, activity CLIENT_CONVERTED), and is idempotent (converting again returns the same client and writes nothing). Converted can never be entered with a plain stage move (409 DOMAIN_ONLY). `GET /enquiries/:id` gained `conversion: { eligible, alreadyConverted, stageKey, stageLabel, client? }`. UI: a **Convert to Client** button on the enquiry detail page (disabled with a reason until booked), a confirmation dialog, a Client card/link after success; dragging a card onto Converted on the board opens the same dialog. The dashboard's Converted count now moves.

### Phase 12 result and deviations
Delivered: a **scope-aware operational dashboard**, **seven reports with CSV export**, and a **global search** in the app shell. No new permission, model or migration: everything reuses `dashboard.view`, `reports.view`, `reports.export` and each resource's own `.view`.

Authorization (all three areas)
- Every query goes through `scopedRepo`, so the role's branch / assignment scope is the first `$match` of every count, aggregation and list; the client's `branchId` / `assignedTo` can only narrow (a branch outside the caller's scope is a 403). Having `dashboard.view` or `reports.view` never opens a resource: each section / report / search type also needs that resource's `.view` permission. A section the user may not view is **absent** from the response (`allowed.<section> = false`) and the UI shows a notice, not zeros.
- Models without an owner field (stage history, activities) are restricted explicitly for OWN scope: stage entries to the ids of enquiries the caller can see, the activity feed to the caller's own actions and to references of resources they may view, documents to their own uploads re-checked against the parent record.

Dashboard (`GET /dashboard/summary | funnel | sources | performance`; `from`/`to` are business-time-zone calendar days, inclusive, at most 366 days, default last 30; the comparison is the same number of days immediately before; unknown parameters are refused)
- New enquiries = created in range, non-archived. Active enquiries = right now in any FLOW stage before the stage whose `domainOperation` is `enquiry.convert` (found from the workflow, not by name; lost and archived excluded; not limited to the range). Converted = distinct enquiries that ENTERED that stage in the range (from stage history), plus how many are in it now. **No operation moves an enquiry to Converted yet, so this is 0 until conversion exists.**
- Follow-ups today / missed / upcoming / open reuse the follow-up list's own filters (the numbers equal `/followups/summary`); completed is compared with the previous period. Site visits today / upcoming / overdue reuse the visit list's views; completed is compared.
- Units by current status (AVAILABLE / BOOKED / SOLD by `statusKey`, plus every other status from the masters). Bookings: **active = status ACTIVE only (released never counted)**; made = by booking date; released = by release date; both compared. New clients, new referrals (and total) compared. No commission / payout metric exists.
- Funnel: for each configured stage (rename / reorder / add flows through) two **separate measures**: `current` (in the stage now; ignores the range) and `entered` (distinct enquiries that entered it in the range, from the append-only history). They are counts, not conversion rates; the response and UI say so. Sources: enquiries created in range by source master, with how many are in the booking stage or later now. Performance: per employee, enquiries created / bookings made / visits completed / missed follow-ups now, only the columns the user may view and only the people and records they can see (an OWN user sees themselves only).
- UI: filters (dates, branch for multi-branch users, salesperson for non-OWN users), KPI cards with previous-period change in plain numbers and a definition on every card, cards link to the module list with the matching filter query parameters (the list re-applies the user's permissions), funnel / sources / team panels that fail independently, recent activity, and loading / error-with-retry / 403 / empty states.

Reports (`GET /reports`, `GET /reports/:key`, `GET /reports/:key/export.csv`; keys `enquiries`, `followups`, `sitevisits`, `units`, `bookings`, `referrals`, `funnel`)
- Each list report reuses its module's own list query schema, filter builder and row builder (so the table, the module list and the CSV cannot disagree): server-side filters (date range, branch, salesperson, stage / status / view, masters), sorting, pagination, total and a grouped summary. The catalogue only lists reports the user can run. The CSV streams in id-ordered batches with the same scope and filters, a BOM, the shared `csvCell` formula neutralisation, phone with country code, a row cap `EXPORT_MAX_ROWS` (413 `EXPORT_TOO_LARGE` as normal JSON before any byte), and an `export` audit entry (row count and filters; the free-text search is recorded as `[set]`, never its value).
- Bookings keep ACTIVE and RELEASED apart (status filter + column). Referrals have no commission, payout or status. A referral report names linked enquiries only when the caller may view enquiries. Funnel report states both measures and exports them as two labelled columns.

Global search (`GET /search?q&types&limit&page`)
- Record types: clients, enquiries, units, bookings, referrals, site visits, documents. Per type, the caller's own `.view` permission, scope and archived filter apply before any text match (each type is searched through its own scoped repository); naming a type the user cannot view is a 403, omitting `types` searches only the viewable ones. Matching is bounded and index-friendly: record numbers by prefix and bare number (`42` finds `ENQ-000042`), names by word start, phone digits (from 6 digits) only where the type exposes phones; everything escaped, no free regex, 2-64 characters, at most 20 per type, 3 s `maxTimeMS`, paging only for a single type. **The Person collection is never queried**: a person who has no visible record cannot be found or confirmed (Phase 4 privacy). Documents return metadata only (number, name, record) and no storage key, URL or content. Audit logs are not searched.
- UI: one debounced box in the top bar (keyboard navigation, type filter, grouped labelled results, loading / empty / error / forbidden messages), hidden entirely if the user can view none of the types; a result opens the record's own page, which checks access again.

Tests: server 799 → 849, web 282 → 311 (`npm run check`, both Docker images build).

Limitations / deviations
- Converted was 0 until the conversion operation was added (see "Enquiry conversion" above). Stage entries are counted from history: enquiries imported with no history do not appear in `entered`; the enquiry-id list used for OWN scope or enquiry filters is capped at 50 000 (a clear error beyond that).
- The OWN-scope activity feed is limited to the user's own actions (activities have no owner field). The funnel `entered` counts are not a cohort and are never turned into a percentage. There is no chart library: bars are plain CSS in a table.
- Roles created before this phase keep the permissions they already had; no grant is required (the system Manager role already holds `dashboard.view`, `reports.view`, `reports.export`; a Sales Executive has `dashboard.view` only, so sees the dashboard and search but not reports).
- Searching free-text inside documents' contents is out of scope (metadata only).

### Phase 11 result and deviations
Delivered: **business documents** attached to six kinds of record, with private storage and permission-checked, short-lived download links; and **WhatsApp template management** (master-driven, with a controlled placeholder list). **No WhatsApp sending or provider code exists.** Unit photos and brochures (the "unit media" item of the original plan) were already delivered in Phase 7.

Documents
- Supported records: client, enquiry, unit, site visit, booking, referral (a registry in `document.entities.ts`; each resolves the record through the CALLER's own scoped repository). A document inherits all access rules from its record: it is usable only if `documents.view` (or the relevant permission) is held, the document's branch is in scope, AND the caller can see the record (so OWN users reach the documents of records assigned to them and nothing else). Not found, foreign and invisible are the same 404.
- Model `documents`: `documentNo` DOC-000001 (atomic counter, immutable); `branchId`, `entityType`, `entityId`, `entityNo` fixed at creation from the record; `documentTypeId` (DOCUMENT_TYPE master, must be ACTIVE when chosen, retired values stay readable); `name`, `notes`; the current `file` ({version, storage key, format, detected mime, bytes, original name, uploader, time}), `previousFiles[]` (replaced versions, kept), `contentHash`; soft-delete fields. No API ever returns a storage key or URL.
- Storage lifecycle: files go to PRIVATE storage (Cloudinary `authenticated` delivery); the storage layer gained `access: 'private'`, `signedUrl()` and a per-access `destroy`. Upload: access check (permission + record visible and open) happens BEFORE the body is read; content is sniffed (PDF/JPEG/PNG/WebP only, SVG and programs refused), the file name must agree with the content and is reduced to a plain name, size capped by `DOCUMENT_MAX_BYTES`; then store, then one transaction (record + audit + timeline). Any failure after the upload deletes the stored file. Download: `GET /documents/:id/url` generates an expiring signed link (`DOCUMENT_URL_TTL_SECONDS`, default 300 s) after the access check; it is never stored or listed, and each issue is audited (best effort).
- Replace (`POST /documents/:id/file`): compare-and-set on the file version (simultaneous replacements: one wins, the loser's upload is removed); the old file stays as a retrievable earlier version (`?version=`). Archive (`DELETE`) is soft: files and history are kept and still retrievable by authorized users. Updating changes title/type/notes only.
- Duplicates: the same file (SHA-256) cannot be attached twice to one record while the first is active (partial unique index): double clicks and retries cannot create twins; another record or an archived copy never blocks.
- API: `GET /documents` (filters: record, type, branch, dates, search; record type alone allowed), `GET /documents/entity-types`, `POST /documents?entityType&entityId` (multipart), `GET /documents/:id`, `GET /documents/:id/url`, `PATCH`, `POST /documents/:id/file`, `DELETE`. Timeline: `/activities?refType=document&refId=` (authorizer registered); events also appear on the record's timeline. Activity types DOCUMENT_UPLOADED (existing), UPDATED, REPLACED, ARCHIVED.
- Permissions: `documents.{view,upload,edit,archive}` (`delete` renamed `archive` with a migration entry; `edit` added). Manager gets all; Sales Executive view and upload. Without a record in the request, an OWN-scope user's list shows only documents they uploaded (limitation: documents others attached to their records are reached through the record).
- Limitation: a crash between the storage upload and the database commit can leave an unreferenced private file (there is no clean-up job yet); every handled failure cleans up.
- UI: a Documents card on the client, enquiry, unit, site visit, booking and referral pages; a Documents list and detail page (versions, timeline, audit). Loading, empty, error and permission states included.

WhatsApp templates
- Model `whatsapptemplates`: `name` (unique per event among non-archived, case-insensitively, race-safe), `categoryId` (WA_CATEGORY) and `eventId` (WA_EVENT), `body` (max 1024), `variables[]` (DERIVED from the body by the server; a client-sent list is refused), `isActive`, soft archive. Company-wide like the global masters it uses: anyone with `whatsapp_masters.view` sees the same list; changing needs `whatsapp_masters.manage` AND access to all branches (the existing global-master rule). Reference checkers protect WA_CATEGORY / WA_EVENT from deletion while a template uses them; retired values stay readable and a template stays editable (only a CHANGED category/event must be active).
- Placeholders: only `{{name}}` with a lower-case snake_case name from the server's list (`lib/templateVariables.ts`: client_name, enquiry_no, unit_name, unit_code, unit_price, unit_location_url, visit_datetime, booking_no, booking_date, branch_name, employee_name). Unsupported names, `{{ spaced }}`, `{{}}`, upper case, nesting and stray braces are rejected together as field errors on `body`. `unit_location_url` is the hook for sharing a unit's exact location later; images and documents can be attached later without changing the body format.
- API: `GET /whatsapp-templates`, `/variables`, `/:id`, `POST`, `PATCH`, `DELETE` (archive). There is no send/test route. Audit: create, update, archive. Permissions: `whatsapp_masters.{view,manage}` (`view` added). UI: WhatsApp Templates page under Setup with a placeholder picker and live checking.

Seeds/migration: run `npm run seed` (the DOCUMENT_UPDATED / REPLACED / ARCHIVED activity types; no document types, WhatsApp categories or events are seeded, as for every other business dropdown: administrators define them in Masters before documents or templates can be created) then `npm run migrate` (`documents.delete` -> `documents.archive`). Roles stored before this phase need `documents.edit`, `documents.archive` and `whatsapp_masters.view` granted in the Roles UI. New settings: `DOCUMENT_MAX_BYTES`, `DOCUMENT_URL_TTL_SECONDS`.

### Phase 10 result and deviations
Delivered: **Referral** as a first-class, branch-scoped record with three controlled creation flows (existing client, existing employee, external person), assignment with history, linking of enquiries, soft archive, timeline and audit, and the Referrals UI. V1 scope held: anyone can refer; there is **no** commission, percentage, payout, payment, incentive, settlement or status.

Identity model (unchanged): Person = global identity, Client = a person's relationship with a branch, Referral = a person's standing as a referrer for a branch. A person can be all three without a duplicate Person; the referral stores only a search projection (`personName`, `phoneE164`, re-synced on identity edits).

Data model: `referrals` (`referralNo` REF-000001 from the atomic counter, immutable; `branchId`; `personId`; `typeId` (REFERRAL_TYPE master); `sourceClientId`/`sourceClientNo` or `sourceUserId` for the client / employee flows; `reason`; `notes`; `assignedTo`/`assignedAt`; `enquiryIds[]`; soft delete) and `referralAssignments` (append-only). `enquiries` gained an optional `referralId` (set and cleared only by the referral's link operations). Scope: BRANCH by `branchId`, OWN by `assignedTo`.

Flows
1. **Client** `POST /referrals/from-client/:clientId`: the client is found through normal scope (404 otherwise); its Person is used as is; the branch is the client's; no Person is created or edited; the source client is kept.
2. **Employee** `POST /referrals/from-user/:userId`: the employee must be visible, active, in the branch (chosen if they have several) and have a valid phone. A Person with that phone that the caller can see is reused untouched; a Person that exists only in other branches is **never attached or revealed** (HIDDEN_MATCH, as in Phase 4); otherwise a Person is created from the employee's name and phone in the same transaction.
3. **External** `POST /referrals`: Phase 4 resolution unchanged (`personId` = explicit use of a visible person, else `person` details; an existing phone is reported `PERSON_EXISTS`, visible or hidden, never duplicated or merged). The caller never sends a type: the flow sets it (REFERRAL_TYPE system keys CLIENT / EMPLOYEE / EXTERNAL).
Person and referral are written in one transaction; a failure leaves neither. Reusing a person already related to the branch performs no write to the person at all.

Duplicates and concurrency: **a person has at most one non-archived referral per branch** (partial unique index `one_active_referral_per_person_per_branch`, verified in the database); a repeated, retried or concurrent conversion gets `409 REFERRAL_EXISTS` naming the existing record when visible, and exactly one record is created (tested with parallel requests). Archiving frees the slot. Referral numbers come from the atomic counter, so parallel creation never collides; numbers can have gaps (a losing attempt consumes one). Simultaneous creation of the same new phone yields one Person and one Referral.

Linking: `POST /referrals/:id/enquiries {enquiryId}` records that an enquiry came through the referral; it never creates an enquiry. The enquiry must be visible, in the same branch and not the referrer's own; an enquiry has one referral (compare-and-set while empty, same transaction as the referral's list); linking the same pair again is a no-op; a competing link is `409 ENQUIRY_ALREADY_REFERRED`. `POST /referrals/:id/enquiries/:enquiryId/unlink {reason}` corrects a mistake. The enquiry detail shows its referrer and the referral lists its (visible) enquiries.

Permissions: `referrals.{view,create,edit,archive,assign,export}` (`delete` renamed `archive` with a migration entry; `assign` added; `export` reserved, no endpoint). `edit` also covers linking. Manager gets all; Sales Executive keeps view and create. Roles stored before this phase do not receive `archive` / `assign` automatically: grant them in the Roles UI.
API: `GET|POST /referrals`, `POST /referrals/from-client/:clientId`, `POST /referrals/from-user/:userId`, `GET|PATCH|DELETE /referrals/:id`, `POST /referrals/:id/assign`, `POST /referrals/:id/enquiries`, `POST /referrals/:id/enquiries/:enquiryId/unlink`. Timeline via `/activities?refType=referral&refId=` (authorizer registered). Audit actions: `create_external`, `convert_client`, `convert_employee`, `update`, `assign`, `link`, `unlink`, `archive`. New activity types: REFERRAL_UPDATED / ASSIGNED / ARCHIVED / LINKED / UNLINKED (REFERRAL_CREATED existed).
Master references: REFERRAL_TYPE (any referral, archived included); inactive values stay readable. No new master, no notifications. UI: Referrals list/detail, a create dialog whose three ways are separate choices, "Make referrer" on clients and in the users list, a Referral card on the enquiry detail.
Seed/migration: run `npm run seed` (new activity types) then `npm run migrate`.
Deviations from the plan above: no `status` or `convertedAt` (conversion status is not part of the V1 scope); no `GET /referrals/:id/history` (the shared timeline and audit are used); no referral field on the enquiry create form (the link is a controlled operation, per the brief).

### Phase 9 result and deviations
Delivered: **Booking** as its own branch-scoped record (never just a unit status), atomic booking and release, database-enforced one-active-booking-per-unit, the booking-conflict queue with manager resolution, ownership of the `BOOKED` workflow stage, unit/enquiry integration, and the Bookings UI.

Data model: `bookings` (`bookingNo` BK-000001 from the atomic counter, immutable; `unitId`/`unitCode`, `enquiryId`/`enquiryNo`, person projection and optional `clientId` all fixed at creation; `salespersonId` (the OWN-scope owner) and immutable `bookedBy`; `bookingDate` (an instant, UTC); `notes`; `status` ACTIVE|RELEASED; `releasedAt/By/Reason`), `bookingEvents` (append-only CREATED / UPDATED / RELEASED with who, when, why) and `bookingConflicts` (the lost attempt: who, which enquiry, what held the unit, OPEN|RESOLVED + resolution). Booking states are record states in code, not a master, so no new master and **no master reference checkers were needed** (the unit's UNIT_STATUS reference already exists).

Indexes: **`one_active_booking_per_unit`: unique `{unitId}` with `partialFilterExpression: {status: 'ACTIVE'}`** (verified in the database by a test, which also inserts around the service and around Mongoose); unique `bookingNo`; `(branchId,status,bookingDate)`, `(unitId,createdAt)`, `(enquiryId,createdAt)`, `(salespersonId,status)`.

Transaction boundaries and concurrency
1. **Book** (`POST /bookings`) validates everything that can be checked first (unit and enquiry visible and in the same branch, enquiry not lost, salesperson valid, workflow move allowed, booking date), then one transaction: compare-and-set the unit `AVAILABLE -> BOOKED`, insert the booking (the partial index independently refuses a second ACTIVE one), history event, enquiry stage move (`persistTransition`), audit (booking and unit), timeline activity, notification. It is never "find, check, create".
2. **Losing** (the compare-and-set matches nothing, or the index refuses) rolls the whole transaction back and answers `409 BOOKING_CONFLICT`; only then, in a separate transaction, a `bookingConflicts` row, an audit entry, a `BOOKING_CONFLICT` activity and a manager notification are written. The loser's enquiry does not move and no booking activity/audit claims success. N parallel attempts give exactly one ACTIVE booking and N-1 conflicts (tested with 5 in parallel). The response names the holding booking only when the caller could see it anyway. Any other failure (for example a clashing booking number) is a normal error, not a conflict, and rolls back completely.
3. **Release** (`POST /bookings/:id/release`, `bookings.release`, reason required): one transaction, conditional `ACTIVE -> RELEASED` (a second or concurrent release matches nothing: `ALREADY_RELEASED`), unit `BOOKED -> AVAILABLE` (if the unit is not BOOKED the whole release is refused, `UNIT_STATE_MISMATCH`), history, audit, activity, notification to the salesperson and managers. The booking is kept for ever. The enquiry stays at BOOKED (no guessed stage; a manager can revert it).
4. **Resolve** (`POST /booking-conflicts/:id/resolve`, `bookings.resolve_conflict`): `KEEP_EXISTING`, or `REPLACE` (reason required): in one transaction release the holder, book the unit for the challenger (with the challenger as `bookedBy`) and close the conflict; any failure leaves everything as it was.

Workflow and units: `BOOKED` is entered only by booking via `plan({ via: 'booking.create' })`, from the stage just before it (`NEGOTIATION`); earlier stages get `STAGE_SKIP`; an enquiry already at or past it is not moved; a lost enquiry is refused. The generic enquiry transition stays `DOMAIN_ONLY` for BOOKED. `POST /units/:id/status` still rejects entering or leaving BOOKED and archiving a booked unit is refused (Phase 7 behaviour unchanged). Unit detail returns a `booking` panel (active booking, history, `allowed.book` / `allowed.release`) only to users with `bookings.view` and within their scope.

Permissions: `bookings.{view,create,edit,release,resolve_conflict,export}` (`edit` and `export` added; `export` reserved, no endpoint). Manager has all; Sales Executive has view and create and only books with a unit and enquiry they own. Existing deployed roles keep their stored permissions: grant `bookings.edit` / `bookings.export` in the Roles UI.
Scope: BRANCH by `branchId`, OWN by `salespersonId` (conflicts: by `attemptedBy`). A foreign `branchId` filter is 403; a foreign booking, conflict, unit or enquiry is 404.
API: `GET|POST /bookings`, `GET|PATCH /bookings/:id`, `POST /bookings/:id/release`, `GET /booking-conflicts`, `POST /booking-conflicts/:id/resolve`. There is no delete and no status route. Timeline via `/activities?refType=booking&refId=`.
Notifications (Phase 6, in-app): `BOOKING_CREATED` (managers, not the booker), `BOOKING_CONFLICT` (managers), `BOOKING_RELEASED` (the salesperson and managers, not the releaser).
Seed/migration: run `npm run seed` (new activity types `BOOKING_UPDATED`, `BOOKING_CONFLICT`, `BOOKING_CONFLICT_RESOLVED`); no data migration.
Deviations from the plan above: no `amount` on bookings (not requested); no unit `version` field (the status compare-and-set and the partial index cover the race); no archive for bookings (they are permanent history); no final client conversion (a booking only links the person's existing client record of that branch, if any). Booking numbers are not gapless: a failed or conflicting attempt consumes one.

### Phase 8 result and deviations
Delivered: **SiteVisit** (branch-scoped, always tied to an existing enquiry, one or more units by reference), controlled lifecycle (schedule, edit, assign, complete, cancel, archive), ownership of the two domain-owned workflow stages, the single automatic next-day follow-up, reminders, and the Site Visits UI (list, schedule with multi-unit picker, detail, assign, complete, cancel, archive; enquiry-detail section; Kanban drop onto the guarded stage opens the schedule dialog).

Data model: `sitevisits` (`visitNo` SV-000001 from the atomic counter, immutable; `enquiryId`/`enquiryNo`/`personId`/person projection/optional `clientId` taken from the enquiry, never the request; `assignedTo`; `scheduledAt`; `units[{unitId, unitCode}]` references only; `notes`; `latitude`/`longitude`; `statusId` + `statusKey` (SITEVISIT_STATUS master); completion fields (`completedAt/By`, `feedback`, `completionNotes`, `followUpId`); cancellation fields; `upcomingNotifiedAt`; soft delete) and `sitevisitAssignments` (append-only). Scope: BRANCH by `branchId`, OWN by `assignedTo`. `followups` gained an immutable `siteVisitId` with a **unique partial index**.

Decisions
1. **Workflow ownership.** The two stages are entered only by the visit, via the existing `WorkflowDefinition.plan({ via })`: scheduling moves an enquiry *from the stage before* SITE_VISIT_SCHEDULED (so an enquiry still at NEW is refused with `STAGE_SKIP`; a second visit for an enquiry already at/past the stage does not move it), completing moves SITE_VISIT_SCHEDULED to SITE_VISIT_COMPLETED (an enquiry that was moved elsewhere meanwhile is left alone). Stages are found by their `domainOperation`, not by name. Generic transition into either stage stays `DOMAIN_ONLY`. To make this possible without duplicating rules, `transitionEnquiry` was split into `prepareTransition` (validation) and `persistTransition` (compare-and-set + history + audit + activity inside the caller's transaction); behaviour of the generic endpoint is unchanged. **Cancelling does not move the enquiry** (a manager with `enquiries.revert` can step it back).
2. **Completion** (one transaction): claim the visit with `{status: SCHEDULED}` compare-and-set, create exactly one follow-up (unique `siteVisitId`), move the enquiry, audit + `SITE_VISIT_COMPLETED` activity. A retry gets `ALREADY_COMPLETED` 409; concurrent completions: one wins, the rest 409; any late failure rolls everything back. Feedback is required; completed-at defaults to now (not in the future); optional coordinates are the visit-location snapshot and never touch units.
3. **Next-day follow-up.** Type = the FOLLOWUP_TYPE master whose *code* is `POST_VISIT_FOLLOWUP_TYPE_CODE` (default `CALL`; nothing hard-coded), status PENDING, due at `POST_VISIT_FOLLOWUP_HOUR` (default 10:00) on the next calendar day in `APP_TIMEZONE` (DST-safe `nextLocalDayAt`), anchored to the enquiry. Assigned to the enquiry's owner, else the visit's assignee, else the person completing (first active, valid one). If the configured type is missing/inactive, completion is refused with `POST_VISIT_FOLLOWUP_NOT_CONFIGURED` *before anything is written* (never silently skipped). The follow-up gets its own audit, `FOLLOWUP_SCHEDULED` activity and assignment notification via the shared `insertFollowUp` helper (extracted from `createFollowUp`, unchanged behaviour).
4. **Who may complete.** An OWN-scope executive assigned a visit may complete it even if they cannot see the enquiry (e.g. a manager's enquiry): the enquiry step and the follow-up run with the *visit's branch* as scope; permissions are unchanged and they gain no lasting access.
5. **Units** are validated at scheduling: exist, visible to the actor, same branch as the enquiry, not archived (400 with the offending index). Units already on a visit are not re-validated on edit (they may have been archived or reassigned since) and stay readable, showing as archived; a viewer who cannot see a unit sees its code only. Scheduling/completing never changes a unit's owner, status or location. Zero to 20 units; zero is allowed so a visit can be planned before units are chosen.
6. **Assignment** mirrors enquiries/units (reason required to reassign; conditional on previous assignee and open status; history; audit; `SITE_VISIT_ASSIGNED` activity and notification).
7. **Reminders/notifications** (Phase 6 infrastructure, in-app only): `SITE_VISIT_ASSIGNED` and `SITE_VISIT_UPCOMING`; job `sitevisits.upcoming` (every 5 min, `SITEVISIT_REMINDER_MINUTES`, default 60) claims each visit with a conditional update so repeated or concurrent runs notify once; rescheduling or reassigning clears the marker.
8. **Permissions** `sitevisits.{view,create,edit,archive,assign,complete,cancel,export}`: `delete` renamed `archive` (migration entry), `assign` and `cancel` added; "change status" is covered by `complete` and `cancel`. Manager gets all; Sales Executive gets view/create/edit/complete/cancel. Export is reserved.

API: `GET|POST /sitevisits`, `GET|PATCH|DELETE /sitevisits/:id`, `POST /sitevisits/:id/{assign,complete,cancel}`. There is deliberately no status route; PATCH rejects status, assignee, enquiry and branch (400). Timeline via `/activities?refType=sitevisit&refId=` (authorizer registered); visit events are also on the enquiry, person, client and each unit's timeline.
Seed/migration: run `npm run seed` (new activity types) then `npm run migrate`. The FOLLOWUP_TYPE named by `POST_VISIT_FOLLOWUP_TYPE_CODE` must exist and be active (seeded `CALL` by default).
Deviations: the seeded `SITE_VISIT_SCHEDULED` activity type is unused (events use `SITE_VISIT_CREATED`); no separate reschedule endpoint (PATCH `scheduledAt` records it); no calendar view; no map picker (lat/lng fields with an "open in maps" link); no export.

### Phase 7 result and deviations
Delivered: **Unit** as a top-level, branch-scoped entity (no Project/Site above it), controlled assignment with history, controlled status change, soft archive, media (Cloudinary, server-side upload) and the Units UI (list, create/edit, detail, assign, status, media, archive).

Data model: `units` (`unitCode` UNT-000001 from the atomic counter, immutable; `name`; masters `propertyTypeId` / `buildingTypeId` / `locationId` (branch-scoped LOCATION); address, city, state, pincode, latitude/longitude (set together), plotArea, builtUpArea (sq ft), expectedPrice, bedrooms, bathrooms, description; `statusId` + `statusKey` + `statusChangedAt`; `assignedTo` / `assignedAt`; embedded `media[]`; soft-delete fields) and `unitAssignments` (append-only history). Scope: BRANCH by `branchId`, OWN by `assignedTo`.

Decisions
1. **Status** uses the existing UNIT_STATUS master only. A unit starts as AVAILABLE (resolved by system key; never client-supplied). It changes only through `POST /units/:id/status {statusId, from?, reason?}` (`units.change_status`): the target must be an ACTIVE UNIT_STATUS value (so statuses admins add later work without code), the write is compare-and-set on the status the caller saw (`STATUS_CHANGED` 409), and audit + `UNIT_STATUS_CHANGED` activity commit with it. Generic PATCH rejects status (400).
2. **Booking preparation.** BOOKED is *owned by bookings*: the status endpoint can neither enter nor leave it (`BOOKING_OWNED` 409) and a BOOKED unit cannot be archived (`UNIT_BOOKED` 409; the check is part of the archive write, so a booking made meanwhile also blocks it). Nothing booking-specific is stored on the unit. Phase 9 adds a `bookings` collection with a partial unique index (one ACTIVE booking per unit), flips `statusKey` with `updateOne({_id, statusKey:'AVAILABLE'}, …)` in the same transaction (concurrent bookings: exactly one wins), and does release/conflict handling there.
3. **Assignment** mirrors enquiries: `validateAssignee` (active user of the unit's branch visible to the actor; OWN can only take for themselves), reason required to reassign, no-op refused, conditional on the previous owner (`ASSIGNMENT_CHANGED`), history row + audit + `UNIT_ASSIGNED` activity.
4. **Media** (pulled forward from Phase 11 at the product owner's request): `core/storage/` (`cloudinary.client.ts` is the only file importing the SDK; provider interface; in-memory driver for tests). Multipart upload `POST /units/:id/media` (`units.manage_media`; scope is checked *before* the body is read), MEDIA_TYPE master required and ACTIVE, content sniffing (JPEG/PNG/WebP/PDF only; SVG and everything else 415), size cap `MEDIA_MAX_BYTES`, per-unit cap `UNIT_MEDIA_MAX_COUNT` enforced inside the write (concurrent uploads cannot exceed it), upload → persist → on failure the asset is deleted; removal deletes the record first and the asset after commit (a failed provider delete only leaves a logged orphan). Cloudinary credentials stay on the server; the browser only receives public URLs. Production refuses to boot without `CLOUDINARY_*`; outside production without them uploads answer 503 `MEDIA_NOT_CONFIGURED`.
5. **Reference checkers** for PROPERTY_TYPE, BUILDING_TYPE, LOCATION, UNIT_STATUS, MEDIA_TYPE (any unit, archived included). UNIT_STATUS values remain non-deletable by Phase 3 design (deactivate only); the checker is registered and tested directly. Inactive values stay readable on existing units.
6. Archived units: hidden by default, listed with `isArchived=true`, readable, read-only (all controls off via `allowed` flags), history and media records kept.

API: `GET|POST /units`, `GET|PATCH|DELETE /units/:id`, `POST /units/:id/assign`, `POST /units/:id/status`, `GET|POST /units/:id/media`, `DELETE /units/:id/media/:mediaId`. Timeline via `GET /activities?refType=unit&refId=` (ref authorizer registered).
Permissions: `units.{view,create,edit,archive,assign,export,manage_media,change_status}`; `units.delete` renamed `units.archive` (migration entry added); Manager role gets `archive` and `change_status`. New ACTIVITY_TYPEs: UNIT_CREATED / UPDATED / STATUS_CHANGED / ARCHIVED / MEDIA_ADDED / MEDIA_REMOVED. After upgrading run `npm run seed` then `npm run migrate`.
Config: `CLOUDINARY_CLOUD_NAME|API_KEY|API_SECRET|FOLDER`, `MEDIA_MAX_BYTES`, `UNIT_MEDIA_MAX_COUNT`.

Deviations from the plan above: media is delivered here (plan: Phase 11); **no `units/export`** (the permission exists and is reserved; not requested for this phase); **no map picker** (latitude/longitude are validated number fields with an "open in maps" link; the Ivr picker needs a map library and API key); the unit timeline uses the shared `/activities` endpoint instead of `GET /units/:id/timeline`; no `Project`/site fields by design.

### Phase 6 result and deviations
Delivered: first-class **FollowUp** (branch-scoped; anchored to an enquiry XOR a client; person derived; assignee, FOLLOWUP_TYPE, FOLLOWUP_STATUS, scheduled time, notes, outcome, cancel reason) with create / view / edit / complete / reschedule / cancel / archive; **Notification** foundation (personal, branch-scoped, read/unread, event code, refs, dedupe key); idempotent server jobs `followups.missed` (every 5 min) and `followups.upcoming`; summary endpoint for dashboard use; timeline authorizer (`followup` refs), activity + audit events; Follow-ups page (Today / Missed / Upcoming / All, server counts), Follow-ups section on enquiry and client detail, notification bell + page.

Decisions
1. **Status keys** (PENDING / RESCHEDULED / COMPLETED / CANCELLED / MISSED) are the master `systemKey`s, stored as `statusKey` on the record for stable queries; labels/colours stay editable masters. Open = PENDING/RESCHEDULED/MISSED.
2. **Completing never creates another follow-up.** The dialog says so; the user schedules the next one explicitly. (Site Visits, later, will own the "next-day follow-up" rule.)
3. **Missed job**: each overdue follow-up (scheduled + `FOLLOWUP_MISSED_GRACE_MINUTES`, default 30) is claimed by a conditional `findOneAndUpdate` inside a transaction; status change, audit, activity and notifications commit together, so a second or concurrent run finds nothing to do and cannot duplicate. Notifications also carry a unique dedupe key `<event>:<followUp>:<user>`.
4. **Recipients are rules, not hard-coded users**: the assignee, plus branch members holding `notifications.team_alerts` (Manager role by default; wildcard roles count). Notifications are always personal (`userId` pinned) even for ALL/BRANCH-scope users.
5. A missed follow-up that is later completed/rescheduled/cancelled is allowed (MISSED is an open state).
6. "Today" is computed in the configured time zone (`lib/time.ts`, DST-safe).
7. UI actions come from per-record `allowed` flags computed by the server.

API: `GET /followups`, `GET /followups/summary`, `POST /followups`, `GET|PATCH|DELETE /followups/:id`, `POST /followups/:id/{complete,reschedule,cancel}`, `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/:id/read`.
Permissions: `followups.{view,create,edit,archive,export}` (`followups.delete` renamed to `archive`; migration entry added), `notifications.{view,team_alerts}`. New ACTIVITY_TYPEs are seeded: run `npm run seed` then `npm run migrate` after upgrading, or follow-up writes fail with UNKNOWN_ACTIVITY_TYPE.
Config: `FOLLOWUP_MISSED_GRACE_MINUTES`, `FOLLOWUP_REMINDER_MINUTES`.
Not built: email/SMS/WhatsApp delivery (IN_APP channel only), the full dashboard, Site Visit auto follow-up, follow-up export endpoint (permission reserved).

### Phase 5 follow-up (approved changes)
1. **Enquiry Source is now required** when creating an enquiry (`sourceId` in the create schema; still an ACTIVE `ENQUIRY_SOURCE` master value, validated like every other master). Type, Property Type, Building Type and Preferred Location remain optional. A source can be changed but not cleared on update (`sourceId: null` is a 400). Enquiries that already exist without a source keep working (edit, assign, move). The form marks Source required and validates before submitting; the Source error from the server shows on the field. This supersedes deviation 1 above for Source only.
2. **Role-permission migration** (`server/src/migrations`, `npm run migrate` / `migrate:prod`): carries renamed permissions to deployed roles. For each rename (`enquiries.delete`→`enquiries.archive`, and the equivalent Phase 4 rename `clients.delete`→`clients.archive`) every role holding the old key gets the new one (`$addToSet`) and loses the dead old key (`$pull`). It never rewrites a role's other permissions, never duplicates, skips wildcard (`*`) roles entirely, is idempotent and resumable, and audits each changed role (`permissions_migrated`, before/after). Roles that never held the old key are not touched. New permissions that are *additions* (e.g. `persons.*`) are not auto-granted to existing roles; grant them in the Roles UI.

### Phase 4 result and deviations
Delivered: phone normalization, counters, Person identity layer, Clients (branch relationships), duplicate detection + explicit linking, client search/list/detail/update/archive, CLIENT_CATEGORY reference checker, client timeline authorizer, Clients UI (list, create with duplicate flow, detail with timeline and placeholders). Tests: server 367 (+104), web 97 (+20); typecheck, eslint, oxlint, both builds and both Docker builds clean.

**Person identity layer**
- `Person` = company-wide identity, unique by **normalized E.164 phone** (unique index in the database; races end in a clean 409). Fields: name, `phoneE164`, display `phone`, email, address, `branchIds`. No date of birth and no notes: the requirements do not call for them, and notes are branch-specific so they live on the Client.
- `lib/phone.ts` is the single normalizer (accepts `+cc`, `00cc`, 10-digit national, trunk `0`, bare `cc`+10; ignores spacing/punctuation; rejects letters, wrong lengths and junk like `0000000000`). Default country code from `DEFAULT_COUNTRY_CALLING_CODE` (national length 10 is India-oriented). Search by phone uses the same digit rules.
- **Access model.** `Person.branchIds` is a *relationship index*, not ownership: the branches in which the person has an authorized business relationship (a client today; enquiries, visits, referrals as they ship call `ensurePersonInBranch`) or was explicitly linked. Visibility = the standard scope plugin on `branchIds`. There is **no person list/search/get-by-id endpoint**. The only cross-branch operations use the new `identity` system scope, confined to `person.service`: existence-only phone checks, explicit linking, uniqueness checks, and rewriting the client search projection.
- **Duplicate detection** (`POST /persons/lookup`, `POST /persons`, `POST /clients`): `NONE` → create; `VISIBLE_MATCH` (person related to a branch the caller can see) → the record is shown and the caller must explicitly choose "use this person" (`personId`); `HIDDEN_MATCH` (exists only in other branches) → **existence only** (no name, branch or id) plus `canLink`. Invalid phone → 400 with a field error. Create returns 201 / 409 `PERSON_EXISTS` (details carry the match) / 400. Nothing is ever merged or silently duplicated. Hidden-match probes are audited (without the number).
- **Linking** (`POST /persons/link`, `persons.link`, reason required): the only way a person becomes visible to a branch with no relationship; audited and recorded as a `PERSON_LINKED` activity; idempotent; the actor must belong to the target branch.
- Identity edits (`PATCH /persons/:id`, `persons.edit`): visible people only; phone stays unique (a clash with a person in an invisible branch reports `PHONE_TAKEN` without detail); audited company-wide; rewrites the client search projection in every branch in the same transaction. Responses only ever list the caller's own branch ids.
- Deliberate trade-off: revealing that a number exists elsewhere (existence only) is unavoidable, since a second person cannot be created. It is gated by `persons.lookup`/`persons.create` and audited.

**Clients**
- **Decision (deviation from the architecture doc, needs your confirmation):** a **Client is a person's relationship with ONE branch**, one record per (person, branch), not one record with `branchIds[]`. Reasons: normal branch scoping then applies unchanged, branch-specific data (category, notes, assignee) can never leak across branches, and archiving/ownership are per branch. "The same client across branches" = one Person with several Client records. Unique partial index on (person, branch) for non-archived records; branch and person are immutable.
- Client ID: `CL-000042`, from an atomic counter (`core/counters`); unique and increasing, **not gapless** (a failed create leaves a gap by design, to avoid every creator contending on one document inside the transaction). Verified under 20 parallel creators across two branches (unique and contiguous when none fail).
- Fields: `clientNo`, `personId`, `branchId`, category (CLIENT_CATEGORY master, optional), `assignedTo` (OWN-scope owner), branch-only `notes`, soft-delete fields. `personName` and `phoneE164` are a **denormalized search projection** (the scope layer refuses joins into scoped collections; this gives branch-scoped search and sorting). The Person stays authoritative and the projection is rewritten on identity change.
- Create is one transaction (person if new + branch attach + client + audit + activity). OWN-scope creators are assigned automatically; ALL scope must choose a branch; assignee must be an active user of the client's branch (OWN users can only pick themselves).
- Search (`?search=`): name (contains, case-insensitive), phone (any notation, partial digits), client ID prefix; all inside the caller's scope; server-side pagination (max 100), sort by name (case-insensitive collation)/number/date; filters for category, assignee, branch (narrow only) and archived. No unrestricted global person search was added; the queries are scope-safe building blocks for the later global search.
- Archive = soft delete (read-only afterwards, hidden by default, the person can become a client of that branch again with a new number). Client conversion from Enquiry is not implemented (Phase 5); the service/API foundation is.
- Category rules: only an active category can be chosen for new records or when changed; an unchanged inactive category stays valid; lists and detail always return the category with its active state so history displays. The reference checker blocks deleting a category used by any client in any branch, archived included.
- Timeline: `registerRefAuthorizer('client', …)` (scoped visibility). Events: `CLIENT_CREATED`, `CLIENT_UPDATED` (category/assignee change), `CLIENT_ARCHIVED`, `PERSON_LINKED` (new ACTIVITY_TYPE seeds). Audit: client create / update / `category_changed` / archive; person create / update / link / hidden-lookup. "Client branch relationship changed" is represented by linking and by creating a client in another branch (a relationship is never moved).
- Permissions: `persons.lookup|create|edit|link`, `clients.view|create|edit|archive|export` (`clients.delete` renamed `archive`, `clients.link` folded into `persons.link`). Seeds: Manager gets all person/client permissions incl. archive; Sales Executive gets `persons.lookup` plus client view/create/edit. **Existing databases keep their old role definitions** (seeds never overwrite admin-edited roles): add the new permissions to existing roles in the Roles UI.
- New system scope reason `identity` (allow-list: `person.service.ts` only); `client.references.ts` uses `integrity`.

Deviations / notes:
1. Client-per-branch model instead of the architecture's single client with `branchIds[]` (above).
2. Counters were specified in earlier docs but did not exist; they were built here (`core/counters`).
3. No `GET /persons/:id` (no standalone person browsing) and no person timeline authorizer; a person's history is seen through its clients.
4. The client list cannot sort by phone or branch; search covers them.
5. Client-name search is an unanchored regex over the branch's clients (indexed by branch); fine at expected volumes, revisit if a branch reaches hundreds of thousands of clients.

### Phase 3 result and deviations
Delivered: generic Masters (registry, model, CRUD, reorder, conservative delete, seeds, admin UI), workflow stage configuration + the enquiry state machine (`WorkflowDefinition`) + admin UI, scoped activity read API, scoped append-only audit read API, `MasterSelect`/`MasterBadge`. Tests: server 263 (+92), web 77 (+16); typecheck, eslint, oxlint, both builds clean.

**Masters**
- One `masters` collection; `type` must be in the central registry (`modules/masters/masterTypes.ts`: key, label, group, scope, reorderable, disableable, deletable, manage permission, hasColor). Types: ENQUIRY_SOURCE, ENQUIRY_TYPE, LOST_REASON, PROPERTY_TYPE, BUILDING_TYPE, LOCATION, UNIT_STATUS, MEDIA_TYPE, FOLLOWUP_TYPE, FOLLOWUP_STATUS, SITEVISIT_STATUS, CLIENT_CATEGORY, REFERRAL_TYPE, DOCUMENT_TYPE, ACTIVITY_TYPE, WA_CATEGORY, WA_EVENT. MEDIA_TYPE was added (architecture/requirements call for master-driven media types).
- Values: `type`, immutable `code` (unique per type, and per branch for branch types), `label`, `description`, `sortOrder`, `isActive`, optional immutable `systemKey`, `color` (status-like types), small `meta`, `branchId` (branch types only), audit stamps.
- **Enquiry statuses are the workflow stages, not a master type** (single source of truth); the Masters UI links "Enquiry Statuses →" to the workflow page.
- **Scope decision (needs your confirmation):** all types are GLOBAL (company-wide, managed by ALL-scope actors) **except LOCATION, which is BRANCH-scoped** — each branch serves its own city/localities and maintains its own list. Global values are readable by everyone with `masters.view` (they feed dropdowns) but only writable by ALL scope. Branch values follow Phase 2 rules (scopedRepo + plugin, cross-branch ids → 404, client `?branchId` can only narrow). Switching a type's scope later is a data migration, so please confirm LOCATION.
- To support the mixed global/branch case the scope layer gained a **"shared" mode** (`ScopeSpec.shared`, separate read/write filters on `ScopeGrant`): records without a branch are readable by all in scope but writable only by ALL. Covered by new scope tests.
- Permissions: view = `masters.view`; manage = the type's permission (`masters.manage`, or `whatsapp_masters.manage` for WA_*) **and** ALL scope for global types. The permission guard runs *before* validation (401/403 before 400).
- **Deletion is conservative:** only for deletable types, never for `systemKey` values, and only when business modules have registered reference checkers (`registerMasterReference`) and none report a use. Until a module registers a checker, deletion of that type is refused (`DELETE_UNSUPPORTED`) and deactivation is the way to retire a value. **Each future module that stores a master id must register its checker** (add to its phase's definition of done).
- Inactive values: `assertActiveMaster(principal, type, id)` for new/changed records (active + right type + visible); `masterLabels(principal, ids)` resolves ids including inactive ones for display, so history stays meaningful. `MasterSelect` keeps a record's own inactive value visible, marked "(inactive)".
- `systemKey` values cannot be deactivated or deleted, but can be renamed/recoloured/reordered.

**Workflow**
- `workflowStages` (company-wide; not branch-scoped): immutable `systemKey`/`kind`/`isSystem`; editable label, description, colour, active state (custom stages only), position (via reorder). Canonical keys: NEW, CONTACTED, INTERESTED, SITE_VISIT_SCHEDULED, SITE_VISIT_COMPLETED, NEGOTIATION, BOOKED, CONVERTED (+ LOST, outside the chain).
- `entryPolicy`/`domainOperation` are system-managed (not editable): SITE_VISIT_SCHEDULED/COMPLETED, BOOKED and CONVERTED are `DOMAIN` stages, enterable only through their named operation (`sitevisit.schedule|complete`, `booking.create`, `enquiry.convert`). Nothing implements those operations yet.
- Admin rules: add custom stages after any non-final FLOW stage (key `CUSTOM_<SLUG>`, generated, immutable); core stages keep their relative order, NEW first, CONVERTED last; core stages cannot be deactivated; display names unique (case-insensitive). All changes audited and transactional.
- **State machine** (`workflow.definition.ts`, pure, no DB): FORWARD only to the immediate next *active* stage (`STAGE_SKIP` 409 otherwise; a new active custom stage becomes a mandatory step); needs `enquiries.edit`, unless a domain service passes its own `via` (server-side only, never from a client) for a DOMAIN stage; BACKWARD (any earlier active stage) needs `enquiries.revert` + reason; LOST needs `enquiries.lose` + reason; reopen from LOST needs `enquiries.reopen` + reason and may only target MANUAL stages. Permission is checked before reason (no leakage). `registerTransitionGuard` lets later modules add rules (e.g. no leaving BOOKED with an active booking). `availableTransitions()` + `GET /workflow/transitions?from=` drive Kanban drop targets from the same rules.
- Phase 5 will persist moves atomically (`findOneAndUpdate({_id, stageCode: from})`), write stage history, activity and audit.

**Activity** — `branchId` is now required and the model is scoped + append-only (no update/delete for any caller, including system scope; unit-tested). Types must exist as ACTIVITY_TYPE masters (existence only: deactivating a type never blocks recording an event). One activity references many entities via `refs[]`. `GET /activities` (`activities.view`): branch-scoped; OWN scope feeds show only the user's own actions; timelines by `refType`+`refId` additionally require an **entity authorizer** (`registerRefAuthorizer`) so an id alone never opens another branch's history; entity types without an authorizer are refused (fail closed). Only `user` is registered today; **each future module must register its entity type** (Phase 4+ definition of done). Writes go through `systemRepo(…,'event')` from services, with the branch taken from the already-scoped entity.

**Audit** — scoped (entries without a branch — users, roles, masters, workflow — are visible to ALL scope only) and append-only; no write routes exist. `GET /audit`, `GET /audit/:id` need `audit.view` (Admin and Super Admin by default; Manager does not). Read-time redaction of password/secret/token/hash/credential/api-key keys on top of write-time redaction. The `changes: {field: {from, to}}` shape is unchanged. Activity and Audit remain separate models by design.

**Seeds** (`npm run seed`, idempotent): roles → masters → workflow → admin. Masters seed only values the requirements name or code depends on (follow-up types and statuses incl. MISSED as requested, unit/site-visit/referral statuses and types, media types, activity events); sources, enquiry types, property/building types, locations, client categories, document types, lost reasons and WhatsApp categories/events are intentionally **not** seeded. Existing admin edits survive re-runs; missing system keys and the workflow's system-managed rules are re-asserted.

Deviations / notes:
1. MISSED is seeded as a follow-up status as requested, although the architecture derives "missed" at query time; nothing relies on it yet — the Follow-ups phase decides stored vs derived.
2. New `systemRepo` reason `event` (activity/audit recording); allow-list in `conventions.test.ts` extended (activity/audit services, activity-type check, master seed).
3. `HOLD` was not seeded as a unit status (not in the requirements); it can be added as a value later.
4. No Activity/Audit viewer UI in this phase (not requested); APIs are ready.
5. `GET /masters` (grouped loader) returns inactive values only with `activeOnly=false`, which `MasterSelect`/`MasterBadge` use for history.

### Phase 2 result and deviations
Delivered: `core/scope/` — `scopedRepo`, `scopePlugin` (Mongoose enforcement), `ScopeGrant`, `systemRepo` (audited bypass), extended `resolveScope`/`resolveWriteBranch`. `User` and `Branch` are now scoped models; all their access goes through repos. Server tests 171 (+51), web 61 (unchanged), all gates green.

Flow: authenticate → authorize(permission) → principal (from DB) → `scopedRepo(Model, principal, { requestedBranchId })` → Mongoose plugin → database.

How it works:
- **Fail closed.** A model with `scopePlugin` refuses every operation that does not carry a `ScopeGrant`: find/findOne/findById/exists (via findOne), countDocuments, estimatedDocumentCount, distinct, aggregate, updateOne/Many, replaceOne, findOneAndUpdate/Replace/Delete, deleteOne/Many, create/save, insertMany, bulkWrite, and document-level deleteOne/updateOne. Missing grant → `SCOPE_REQUIRED` (500) before the database is touched.
- **Scope is merged with `$and`**, so a caller's own `_id`/`branchId` condition can never overwrite it. (This structurally fixes the Phase 1 bug where the scope key clobbered the id filter; regression tests cover users and branches over HTTP and at repo level.)
- **Writes are validated**: creating in, moving to, or re-pointing at a branch outside the actor's scope is a 403; non-ALL actors cannot `$unset`/`$rename` the branch field or use pipeline updates; upsert is refused; owned docs must have ≥1 branch.
- **Aggregates**: scope `$match` is prepended; `$out`/`$merge`, and `$lookup`/`$graphLookup`/`$unionWith` into another scoped collection (incl. inside `$facet`/sub-pipelines), and stages that must come first (`$geoNear`, `$search`, …) are refused.
- **Branch-ownership convention** for every future module: `...branchOwnedFields` (`branchId`, required, indexed) + `...softDeleteFields`, `schema.plugin(scopePlugin, { branchField, ownerField? })`. `ownerField` is per model (`assignedTo`, `createdBy`, …) and used for OWN scope; `selfField` is for collections where the record IS the actor (Users). New record branch: `resolveWriteBranch(principal, requested?)` — validated against the principal, derived only when unambiguous, never guessed.
- **Repo conveniences**: default exclusion of `isArchived` records (`includeArchived` opt-in), `archiveOne`, `{ session }` passthrough for transactions.
- **System/global operations**: `systemRepo(Model, reason, detail)` is the only bypass. `reason` is a closed set (`auth | seed | migration | job | integrity | test`), every use is reported (log; `onSystemScope` hook for an audit sink), there is no boolean "skip scope" flag, `ScopeGrant` cannot be constructed outside the scope layer, and `conventions.test.ts` pins the exact files allowed to call `systemRepo` (today: authenticate middleware, auth service, branch/role/user services for global uniqueness/in-use checks, admin seed). Adding a call site requires changing that test, i.e. a reviewed decision.

Approved exceptions (documented, tested): authentication and session bookkeeping (no principal exists yet); bootstrap seed; global integrity checks (unique email/branch code, "role still assigned") that reveal existence only; test fixtures (`test` reason, refused outside NODE_ENV=test). Migrations and jobs have reserved reasons but no call sites yet.

Deviations / decisions:
1. Enforcement is two-layered by design: the **repo** attaches the grant and default filters; the **plugin** is the safety net that makes the bare model unusable. Feature code never builds scope filters by hand.
2. Non-ALL actors editing a user's branch list use `$addToSet` then `$pull` in a transaction (add first: removing the last shared branch would take the user out of the actor's scope mid-operation). Memberships outside the actor's reach are preserved. ALL actors set the list directly.
3. A BRANCH actor can no longer create a Branch (a new branch id is by definition outside their scope); only ALL scope can.
4. `Activity`, `AuditLog`, `Role`, `RefreshToken` are **not** scoped in this phase: Role/RefreshToken are global by nature; Activity/AuditLog get scoped read APIs in Phase 3 and will adopt the plugin then (their writes come from system-level services and will be routed through an approved reason).
5. ESLint/`conventions.test.ts` also fail the build if feature code calls scoped models directly, uses `Model.collection`/`connection.db.collection`, or if a model with a branch field lacks `scopePlugin`.

Known limitations (carried forward):
- The raw MongoDB driver (`Model.collection`, `connection.db`) bypasses Mongoose middleware; guarded by `conventions.test.ts`, not by the plugin.
- `.populate()` into a scoped model fails closed (sub-query has no grant); use a second scoped query instead.
- Transactions: hooks work inside `withTransaction`, but scope grants are per call, not per transaction.
- Scope is only as good as the principal: it is rebuilt from the DB per request (Phase 1), so role/branch changes apply on the next request.

### Phase 1 result and deviations
Delivered: login / logout / refresh / me / permissions-catalog; users, roles and branches modules; role-based seeds; real frontend auth; admin pages (Users, Roles & Permissions, Branches). Tests: server 120, web 61, all passing; typecheck, eslint, oxlint, both builds and both Docker builds clean.

Authentication design:
- Access token: HS256 JWT, 15 min, returned in JSON, held **in frontend memory only** (never localStorage/sessionStorage). Claims are just `sub` + `tv` (token version).
- Refresh token: opaque 48-byte random value in an **httpOnly** cookie (`bf_rt`, `Path=/api/v1/auth`, `Secure` in production, `SameSite` from `COOKIE_SAMESITE`, default `lax`). Never in a JSON body. Only its SHA-256 is stored.
- Rotation: every refresh atomically consumes the presented token (concurrent refreshes: exactly one wins) and issues a new one in the same family. Reuse of a consumed token revokes the whole family and is audited. A `REFRESH_REUSE_GRACE_SECONDS` window (default 10) treats near-simultaneous refreshes (two tabs) as a race instead of theft; the client retries once.
- Invalidation: the principal is rebuilt from the database on every request, so role/permission edits, deactivation and `tokenVersion` bumps (password reset, role change, deactivation) take effect immediately; refresh tokens are also revoked on those events.
- Hardening: bcrypt (cost 12, `BCRYPT_COST`), constant-time-ish unknown-email path, generic invalid-credentials error, account lockout (5 failures / 15 min), login rate limit, Origin allow-list check on refresh/logout (CSRF), account state only revealed after the correct password.

RBAC design:
- Permission catalog (code) is the single source; roles reference permission keys + data scope. The seeded Super Admin holds the `*` wildcard; custom roles cannot.
- **Anti-escalation** (not in the original plan, added because roles/users are editable): an actor can only grant permissions and a data scope they hold, cannot edit a role or user more powerful than themselves, cannot change their own role/branches/active flag, and non-ALL actors can only assign branches they belong to. The Super Admin role is immutable.
- A test walks the Express router and fails if any route lacks `authorize()` / `authenticatedOnly` / `publicRoute`.

Deviations from the architecture doc:
1. **Permissions are not seeded into a collection.** They live in the code catalog (as the architecture intended); "seeding permissions" = the catalog is validated and roles are seeded against it.
2. Catalog changed: `users.manage` → `users.view|create|edit` (deactivation = `users.edit`); `roles.manage` kept plus `roles.view`; `branches.view` added next to `branches.manage`.
3. Seeded roles are created only if missing and never overwrite admin edits, except Super Admin, which is re-asserted every run. Admin = everything except `roles.manage`.
4. `User.branchIds` + `primaryBranchId` + role `dataScope` give the effective scope. Per-user grants/denies (the optional `UserRights` idea) were deliberately not built.
5. Branches got only the model + CRUD needed for auth/RBAC (Phase 2 adds the scope plugin and branch switcher).
6. Bootstrap admin: `npm run seed` reads `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from the environment; it never modifies an existing user and never logs the password. `npm run seed:prod` runs the compiled version.
7. The Phase 0 dev-only "Preview as…" login buttons were removed; `/dev/components` remains (dev builds only).
8. Not done (out of scope for the phase): change-own-password, forgot-password/email flows, MFA, per-IP login throttling beyond the in-memory limiter (single instance only; move to a shared store if the API is scaled out).

Carry-over to Phase 2: scope plugin + `scopedRepo`, branch switcher in the Topbar, `/auth/me`-driven branch list.

## Phase 0 — Scaffold & tooling  ✅ DONE
- **Objective**: Runnable empty API + SPA, CI-quality scripts, replica-set dev DB.
- **Files**: `server/{package.json,tsconfig,src/app.ts,index.ts,config/env.ts,lib/{appError,asyncHandler,respond,logger}.ts,middleware/{errorHandler,notFound,requestContext,validate}.ts,test/setupTestDb.ts}`, `web/{vite.config.js,src/app/*,styles/tokens.css,components/ui/*}`, `docker-compose.yml` (mongo `--replSet` + init), `.env.example`, `README.md`.
- **Dependencies**: none.
- **DB**: connect + `mongoCapabilities` check (refuse standalone in prod).
- **API**: `GET /health`, `/ready`.
- **Frontend**: copy from Ivr-Version: tokens/global CSS, ThemeProvider, QueryProvider, Toast, Modal, Drawer, Button, Input, Select, FormField, Pagination, Skeleton, Pill, Segmented, ErrorBoundary, `lib/format.js`; strip plan code. Empty shell + routes.
- **Tests**: env validation fails fast; health endpoint; error handler shape; one web smoke test.
- **Acceptance**: `docker compose up` brings Mongo RS + API + web; `npm test` / `npm run lint` pass in both packages; no secrets committed.

## Phase 1 — Auth, users, roles, permission layer
- **Objective**: Login + the reusable authorization layer (permission strings, data scope).
- **Files**: `core/permissions/{catalog,seedRoles}.ts`, `middleware/{authenticate,authorize}.ts`, `modules/{auth,users,roles}/*`, `seeds/roles.ts`; web: `app/AuthProvider`, `hooks/usePermissions`, `components/Can`, router guard, `features/admin/{UsersPage,RolesPage}`. Ref: grocy `authorizeGrocy.ts`, `roles` feature; Ivr `RolePermissionMatrix`.
- **Dependencies**: Phase 0.
- **DB**: `users`, `roles`, `refreshTokens`. Seed Super Admin/Admin/Manager/Sales Executive + first super-admin user from env.
- **API**: `POST /auth/login|refresh|logout`, `GET /auth/me`, `GET /auth/permissions-catalog`; CRUD `/users`, `/roles` (`users.manage`, `roles.manage`).
- **Frontend**: login, `can()` fail-closed, role editor (matrix from catalog), user management.
- **Tests**: login/refresh/lockout; every route denies without permission (router-walking test that all routes declare `authorize`); permission change applies next request; system roles undeletable; password hashing only bcrypt.
- **Acceptance**: Sales Executive cannot call `/roles`; Super Admin edits a role's permissions and effect is immediate; UI hides unavailable actions but backend still returns 403 when called directly.

## Phase 2 — Branches & branch-isolation layer
- **Objective**: Branch entity and the data-access scope enforcement used by all later modules.
- **Files**: `core/scope/{scopeResolver,scopedRepo,scopePlugin}.ts`, `modules/branches/*`, user↔branch assignment, web: `BranchesPage`, branch switcher (for multi-branch users) in Topbar.
- **Dependencies**: Phase 1.
- **DB**: `branches`; `users.branchIds/primaryBranchId`; test-only scoped model fixture.
- **API**: CRUD `/branches` (`branches.manage`); `GET /auth/me` returns branches + dataScope.
- **Frontend**: branch management; global "branch filter" context (ALL or specific; only for multi-branch users).
- **Tests**: scope plugin throws on unscoped query; ALL/BRANCH/OWN filters; cross-branch id → 404; aggregate scoping; `.unscoped()` only allowed from jobs/seeds.
- **Acceptance**: with a fixture scoped model, a Branch-A manager can neither list nor fetch Branch-B docs by any route; Admin can span branches per permission.

## Phase 3 — Masters, workflow stages, audit & activity core
- **Objective**: Generic master data (all dropdowns), workflow stage config, reusable audit + activity services.
- **Files**: `modules/masters/{masterTypes.ts,routes,service,model}`, `modules/workflow/stages.*`, `core/audit/*`, `core/activity/*`, `modules/activities/*`, `lib/counters.ts`, `seeds/{masters,workflow}.ts`; web: `hooks/useMasters`, `components/MasterSelect`, `MasterBadge`, `features/masters/MastersPage` (generic, config-driven), `features/masters/WorkflowStagesPage`, `components/Timeline`. Ref: Ivr `MasterForms.jsx`/`masterFormsData.js` (idea), `usePlotStatuses` badge pattern; grocy `simpleMasterData`, `documentNumbers`, `activityLogs`.
- **Dependencies**: Phase 2.
- **DB**: `masters`, `workflowStages`, `activities`, `auditLogs`, `counters`. Seed all master types listed in Architecture §6 with sensible defaults + system keys; seed canonical 9 stages.
- **API**: `GET /masters?types=`, `GET/POST/PATCH /masters/:type[/:id]` (`masters.view|manage`; branch-scoped types honoured), `/workflow/stages` CRUD (`masters.manage`), `GET /activities?refType&refId`, `GET /audit` (admin).
- **Frontend**: one generic Masters page covering all master types; deactivate instead of delete; protected `systemKey` rows locked; WA category/event listed (templates in Phase 11).
- **Tests**: unique `(type,code)`; inactive values rejected by consumers (shared helper `assertActiveMaster`); systemKey rows undeletable/non-rekeyable; stage reorder validation (no gaps, LOST excluded from order chain); audit diff + redaction; activity multi-ref query.
- **Acceptance**: an Admin adds a new Enquiry Source in the UI and it appears in every dropdown without code change; grep of `web/src` finds no hard-coded business dropdown values (lint rule/test).

## Phase 4 — Persons, clients & duplicate detection
- **Objective**: Identity layer (phone-based) and Clients.
- **Files**: `lib/phone.ts`, `modules/persons/*`, `modules/clients/*`; web: `features/clients/{ClientsPage,ClientDetailPage}`, `DuplicateMatchDialog`. Ref: plot import phone normalisation (idea only).
- **Dependencies**: Phase 3.
- **DB**: `persons` (unique `phoneE164`), `clients` (unique `personId`, `branchIds[]`).
- **API**: `POST /persons/check-duplicate`, `POST /persons/link`, `/clients` CRUD + `GET /clients/:id` (with enquiries/units/timeline), `/clients/export.csv`.
- **Frontend**: clients list/detail with timeline; duplicate-match dialog reused by Enquiry form later.
- **Tests**: normalisation edge cases (+91, spaces, leading 0); unique race (parallel creates → one person); masked cross-branch match; link requires `persons.link` and writes activity + audit; client branch visibility.
- **Acceptance**: entering an existing phone shows the existing record and never creates a second person without explicit authorized link.

## Phase 5 — Enquiries & workflow engine (list + kanban)
- **Objective**: Core enquiry CRUD plus backend-validated state machine; List and Kanban views.
- **Files**: `core/workflow/{workflow.service,stateMachine}.ts`, `modules/enquiries/*`, `lib/listQuery.ts`; web: `features/enquiries/{EnquiriesPage,EnquiryForm,EnquiryDetailPage}`, `features/kanban/{Board,Card,MoveDialog}`, `components/data/{DataTable,FilterBar}`, `hooks/useTableState`. Ref: Ivr `DealPipelineBoard/DealCard/StageMovementModal`; `FormField`; grolynk `order.stateMachine.ts`; plot `stageHistory`.
- **Dependencies**: Phases 3–4.
- **DB**: `enquiries`, `enquiryStageHistory`; atomic enquiry numbers.
- **API**: `GET/POST/PATCH/DELETE(archive) /enquiries`, `POST /:id/{transition,assign,lose,reopen,convert}`, `GET /enquiries/export.csv`, `GET /enquiries/board` (grouped counts + page per stage). Filters: branch, status, source, type, property/building type, assignee, date range, text; sort.
- **Frontend**: server-driven table with filters/search/sort/pagination; Kanban with stage columns from config; guarded-stage drops open the right dialog; backward move dialog asks reason; LOST asks master reason; mobile card list.
- **Tests**: forward-only (skip → 409); backward needs `enquiries.revert` + reason (403/422); LOST/reopen; concurrent transitions (one 409); Kanban endpoint uses same service (spy test); convert (manual + status-based) creates/links client once; scope + OWN data scope; export scoped & permission-gated; inactive master rejected.
- **Acceptance**: dragging a card two stages ahead is rejected by the backend and the card returns; a Manager reverts with a reason and it appears in history/timeline; Sales Exec sees only own enquiries in own branch.

## Phase 6 — Follow-ups & notifications core
- **Objective**: Follow-up module, in-app notifications, missed/upcoming sweeps.
- **Files**: `modules/followups/*`, `modules/notifications/*`, `core/notify/{notification.service,events,channels/inApp}.ts`, `jobs/{missedFollowups,upcomingFollowups}.ts`, `worker.ts`; web: `features/followups/{FollowUpsPage,FollowUpDialog,Calendar}`, notification bell/list (`useNotifications` 30 s poll). Ref: Ivr `useFollowUps`, `MonthCalendar`, `MeetingAgendaList`, `AddFollowUpDialog`; plot `FollowUp.js`, `flagMissedFollowUps`.
- **Dependencies**: Phase 5.
- **DB**: `followups`, `notifications`.
- **API**: CRUD `/followups` (+`/:id/complete|reschedule|cancel`), `GET /followups?timeframe=today|missed|upcoming`, `GET /notifications`, `POST /notifications/:id/read`, `/read-all`.
- **Frontend**: follow-ups list/calendar, today/missed tabs, schedule from enquiry detail; header bell with unread count.
- **Tests**: missed/today computed correctly in TZ; completing a follow-up creates **no** new follow-up; job idempotent (double run → one notification); assignment notification; scope/OWN.
- **Acceptance**: a follow-up past due produces exactly one missed notification to assignee (+manager) and shows under "Missed" on the dashboard API.

## Phase 7 — Units / properties (no media yet) & assignment history
- **Objective**: First-class Units.
- **Files**: `modules/units/*`, web: `features/units/{UnitsPage,UnitForm,UnitDetailPage}`, `MapPickerModal` (Ivr `PlotMapPickerModal`). Ref: Ivr `PlotsTable`/`PlotFormModal` (adapt), `PlotStatusBadge`.
- **Dependencies**: Phase 3.
- **DB**: `units`, `unitAssignments`.
- **API**: `/units` CRUD/export, `POST /units/:id/assign`, `GET /units/:id/timeline`.
- **Frontend**: list (filters: status, type, building, location, price range, assignee), detail with timeline, location picker.
- **Tests**: unique `(branchId,unitCode)`; reassign writes history + activity; status via master only; scope tests.
- **Acceptance**: unit created without any project/site; reassigning shows in timeline and history.

## Phase 8 — Site visits
- **Objective**: Schedule/complete visits with multiple units; auto next-day follow-up.
- **Files**: `modules/sitevisits/*`, `jobs/siteVisitReminders.ts`; web: `features/sitevisits/*`. Ref: Ivr `pages/Visitors`, `features/visitors/*`; plot `Visitor`/reminder idempotency.
- **Dependencies**: Phases 5–7.
- **DB**: `sitevisits`.
- **API**: `/sitevisits` CRUD, `POST /:id/{complete,cancel,reschedule}`; schedule moves enquiry to `SITE_VISIT_SCHEDULED` through the workflow service.
- **Frontend**: schedule dialog (multi-unit select, date/time, location lat/lng, assignee), visit detail with feedback; calendar integration; Kanban guarded-stage dialog.
- **Tests**: schedule/complete transitions via state machine; completing creates exactly one next-day follow-up (retry safe); unit timeline shows visit; scope.
- **Acceptance**: completing a visit moves the enquiry to SITE_VISIT_COMPLETED, creates tomorrow's follow-up once, and writes activities on enquiry, client and each unit.

## Phase 9 — Booking, conflict handling, release
- **Objective**: Race-safe booking with Manager conflict resolution.
- **Files**: `modules/bookings/*` (+ `bookingConflicts`), `core/` transaction helper; web: `features/bookings/{BookDialog,ConflictsPage,ReleaseDialog}`. Ref: lms partial unique index, crackers `withTransaction`, grolynk `version` claim.
- **Dependencies**: Phases 5, 7, 8.
- **DB**: `bookings` (partial unique index on active `unitId`), `bookingConflicts`, unit `version`.
- **API**: `POST /bookings`, `POST /bookings/:id/release`, `GET /booking-conflicts`, `POST /booking-conflicts/:id/resolve`.
- **Frontend**: Book action on enquiry/unit; conflict banner + manager queue; release with reason.
- **Tests**: N parallel bookings → exactly one ACTIVE + (N-1) conflicts; rollback leaves unit/enquiry untouched; release requires permission + reason; resolution flows; one active booking index verified; notifications to manager.
- **Acceptance**: two salespeople booking the same unit simultaneously never overwrite; the loser gets 409, Manager sees the conflict and resolves it manually.

## Phase 10 — Referrals
- **Objective**: Referral tracking reusing existing people.
- **Files**: `modules/referrals/*`; web: `features/referrals/*`.
- **Dependencies**: Phases 4–5.
- **DB**: `referrals`.
- **API**: `/referrals` CRUD, `POST /referrals/from-client/:clientId`, `/from-user/:userId`, link to enquiry, `GET /referrals/:id/history`.
- **Frontend**: "Make referrer" on client/user; referral field on enquiry form (prefilled person); referral detail with referred enquiries and conversion history.
- **Tests**: no re-entry of data (person reused); type from master; conversion status updates when referred enquiry converts; scope.
- **Acceptance**: converting a Client into a Referrer takes one click and no re-typing; referred enquiry shows its referrer and vice-versa.

## Phase 11 — Documents, unit media (Cloudinary) & WhatsApp masters
- **Objective**: Uploads + the WhatsApp master set.
- **Files**: `core/storage/*` (from crackers `media/*`, lms storage), `modules/documents/*`, unit media endpoints, `modules/whatsappTemplates/*`, `lib/templateVariables.ts`; web: `components/data/FileUploader`, `features/documents/*`, unit gallery (+ `ImageLightboxModal`), `features/masters/WhatsAppTemplatesPage`.
- **Dependencies**: Phases 3, 7.
- **DB**: `documents`, `units.media[]`, `whatsappTemplates`.
- **API**: `POST /documents` (multipart), `GET /documents?entityType&entityId`, `GET /documents/:id/url` (signed), `DELETE`; `POST /units/:id/media`, `PATCH` order/kind, `DELETE`; `/whatsapp-templates` CRUD.
- **Frontend**: reusable uploader on enquiry/client/unit/visit/referral; gallery with kinds from masters; template editor with variable picker (allow-list from API).
- **Tests**: magic-byte rejection/SVG refused; size cap; replace rollback; signed URL requires scope+permission; mock driver in CI; template with unknown variable rejected; document type must be active master.
- **Acceptance**: multiple images per unit with types from masters; private documents unreachable without a valid scoped signed URL; no WhatsApp sending code exists.

## Phase 12 — Dashboard, funnel, reports, global search
- **Objective**: KPIs and reporting on the same workflow config.
- **Files**: `modules/dashboard/*`, `modules/reports/*`, `modules/search/*`; web: `features/dashboard/*` (StatStrip, Funnel with filters, source performance, sales performance, today/missed lists), `features/reports/*`, `GlobalSearch` in Topbar. Ref: Ivr `PipelineOverview`, `FunnelChart`, `TrendChart`, `SourceBar`, `SellThroughMeter`, SalesPerformance/LeadSource/SiteInventory reports; plot `rangeWindow` aggregation shape.
- **Dependencies**: Phases 5–9.
- **DB**: indexes review; no new collections.
- **API**: `GET /dashboard/summary|funnel|sources|performance`, `GET /reports/:name(+/export.csv)`, `GET /search?q=`.
- **Frontend**: dashboard with date range, branch, executive, source, property/building type filters; funnel stages from config; report pages with export.
- **Tests**: funnel follows reordered/added stages; counts match fixtures; scope applied to every aggregation; previous-period; search respects scope + permissions; performance sanity on seeded 50k enquiries (indexes used — `explain` assertions).
- **Acceptance**: Manager dashboard shows only branch data; renaming/reordering a stage changes the funnel without code change.

## Phase 13 — Hardening, polish, deployment
- **Objective**: Release readiness.
- **Files**: security middleware (helmet, rate limits), Dockerfiles, nginx, deploy docs, demo seed, README, accessibility/responsive pass, e2e smoke.
- **Dependencies**: all.
- **DB**: index audit, TTL/archival for notifications (optional), backup guidance (`mongodump` cron doc).
- **API**: audit viewer filters, final permission-catalog review, OpenAPI-lite route listing (generated).
- **Frontend**: empty/error/loading states everywhere, mobile card lists, permission-aware nav review.
- **Tests**: full permission matrix and branch-isolation regression suites across all modules; Playwright smoke (login → enquiry → visit → booking); load sanity.
- **Acceptance**: checklist in §"Definition of done" below passes; production boot fails without Mongo RS/Cloudinary/JWT secrets.

---

## Definition of done (every phase)
0. **Module registration (approved after Phase 3).** Every business module must, in the same change that introduces it: (a) register a **master reference checker** (`registerMasterReference`) for every master id it stores; (b) register an **activity entity authorizer** (`registerRefAuthorizer`) for every entity that exposes a timeline; (c) declare its **scope** (`scopePlugin`, branch field, owner field) and its **permissions** in the catalog; (d) emit **audit** events for important changes; (e) ship **tests** for all of the above. Changing a master type's scope later is a data migration, not an admin setting.
1. Every new route has `authorize` and zod validation; scoped models only accessed through `scopedRepo`.
2. No hard-coded dropdown values in web; no code references to master labels/ids (only `systemKey`s).
3. Business-significant mutations emit Activity and, where applicable, AuditLog.
4. Unit + route tests (incl. permission and branch-isolation cases) pass; lint clean.
5. Archive instead of delete; no files over ~400 lines without reason.

## Suggested sequencing / effort (relative)
P0 S · P1 M · P2 M · P3 L · P4 M · P5 XL · P6 M · P7 M · P8 M · P9 L · P10 S · P11 L · P12 L · P13 M. Phases 7 and 4 can be built in parallel after Phase 3; Phase 10/11 can run parallel after Phase 9. The earliest demo-able CRM slice is Phase 5 (enquiries → kanban → convert).
