# BuildFlow — Reference Inventory

Result of a static read of `KK-Source/` (nothing was run). Paths are relative to `KK-Source/`.
Reuse strategy legend: **Reuse** = copy with minimal edits · **Adapt** = copy the idea/structure, rewrite the body · **Rewrite** = implement differently · **Skip** = not relevant.

## 0. Projects inspected

| Project | Stack | Relevance | Notes |
|---|---|---|---|
| `Ivr-Version` | React 19, Vite 8, react-router 7, react-query 5, plain per-component CSS, hand-rolled SVG charts | **High (primary UI)** | ~383 files. No TS, no Tailwind, no chart/DnD lib, 1 test. Contains lots of IVR-only code (calls, dialer, WhatsApp flows, AI copilot, plan gating). |
| `plot-management-node` | Express 5, Mongoose 8, JWT, BullMQ/Redis, socket.io | **High (domain/business reference)** | ~33k lines, 46 models, ~280 routes (almost all POST), **no tests**, no server-side permission enforcement, no branch isolation. Good domain ideas, weak engineering. |
| `ORIVIL/orivil-grocy` | TS, Express 4, Mongoose 8, zod, pino, vitest, Cloudinary, Tailwind admin | **High (engineering conventions)** | 42 API modules, ~423 API tests, branches module, dynamic roles, document numbers, audit log, notifications, storage. Own QUALITY_SCORE 8.3/10. Grocery modules must be stripped. |
| `crackers-ecommerce` | TS, Mongo, Express, React (plain CSS), Playwright | **High (media + UI polish + transactions)** | Best Cloudinary module, `withTransaction` + capability detection, ui kit (Modal, ActionMenu, EmptyState, ImageUpload, StatusBadge), deploy docs. 532 API tests. |
| `ORIVIL/grolynk` (`grolynk/` top-level is a duplicate + Expo) | TS, Express, Mongo | Medium | Origin of grocy patterns: env zod, errorHandler, stateMachine, activityLogs, atomic stock reservation with `version`. |
| `orivil-lms` | NestJS, Prisma 7, Postgres | Medium (patterns only) | Partial unique indexes for "one active X", `FOR UPDATE`, private signed-URL Cloudinary storage. Different stack — borrow ideas. |
| `samplevpsbackend` = `agri-clinic-management-node` | Express 5 + Mongoose, plain JS | Low | Identical copies. Only the `startSession` pattern is of interest. **Hard-coded Atlas credentials in server.js.** |
| `agro-clinic-management` | React 18 + Vite + MUI | Low | `pages/Role.jsx` idea only. |
| `gk-academytranslator`, `Shiva-Portfolio`, `orivil-landingpage` | — | None | Confirmed irrelevant. |

## 1. Frontend References

Primary source is `Ivr-Version/src`. "UI kit alt" = `crackers-ecommerce/apps/web/src/components/ui`.

| Feature | Reference Project | Location | Reuse Strategy |
|---|---|---|---|
| App shell / providers | Ivr-Version | `app/App.jsx`, `AppShell.jsx`, `QueryProvider.jsx`, `ThemeProvider.jsx` (light/dark/system), `components/ui/ErrorBoundary.jsx` | **Reuse**; strip `PlanContext`. Add lazy route loading + a per-route permission guard (IVR has only `ProtectedRoute`). |
| Auth context | Ivr-Version | `app/AuthProvider.jsx`, `components/auth/ProtectedRoute.jsx`, `services/api/client.js` (96 l) | **Adapt**: token + user in storage and 401 → logout event are good. Add permissions/branches from login payload; `client.js` is POST-only → rewrite as REST client (GET/POST/PATCH/DELETE, query params, blob download). |
| Sidebar / navigation | Ivr-Version | `components/layout/Sidebar.jsx/.css`, `Topbar.jsx` | **Adapt**: mobile-drawer behaviour reusable; static item array filtered by permission (not by role name). |
| Design tokens / global CSS | Ivr-Version | `styles/tokens.css` (335 l, light+dark vars), `global.css`, `pages/shared.css` | **Reuse**; re-skin brand colours; make `--status-*` variables generic (status colours come from masters). |
| UI primitives | Ivr-Version | `components/ui/` Modal, Drawer, FormField, Input, Select, Textarea, Button, IconButton, Card, Pagination, Skeleton, Pill, Segmented, Switch, Avatar, CountBadge, ToastProvider, `useDialogBehavior` | **Reuse**. `ConfirmDialog` closes before async finishes → adapt. |
| Missing primitives | crackers (UI kit alt) | `ActionMenu`, `SearchInput`, `EmptyState`, `StatusBadge`, `FormSection`, `ImageUpload`, `Modal` (phone bottom-sheet) | **Adapt/copy** to fill gaps (IVR has no DataTable, combobox, date picker, tabs, empty state, upload). |
| Data tables | Ivr-Version / grocy admin | `features/leads/LeadsTable.jsx` (669 l, client-side everything); `ORIVIL/orivil-grocy/apps/admin/src/components/DataTable.tsx` + `lib/useTableState.ts` | **Rewrite** as one generic server-driven `DataTable` (sort/page/filter in query params), modelled on grocy's `useTableState`. Do not copy LeadsTable (loads 500 rows, filters client-side). |
| Kanban | Ivr-Version | `features/deals/DealPipelineBoard.jsx`, `DealCard.jsx`, `StageMovementModal.jsx`, `pages/deals/*` | **Adapt**. Native HTML5 DnD (no touch). Keep "drop → confirm modal with note/reason → POST → invalidate query; on error keep modal open, no optimistic update". Columns must come from workflow master, move through the backend state machine; add a "Move to…" menu for touch. There is **no lead board** in IVR — only deals. |
| Funnel | Ivr-Version | `components/charts/FunnelChart.jsx` (`stages`, `selectedStageId`, `onSelectStage`), `funnelPalette.js` | **Reuse** fed from workflow master + server aggregation. Do **not** copy `features/reports/FunnelAnalyticsReport.jsx` (1328 l, plan-gated). |
| Charts | Ivr-Version | `components/charts/` TrendChart, Sparkline, DonutChart, SourceBar, RangeMeter, `scale.js` | **Reuse** (all hand-rolled SVG, zero deps). |
| Dashboard layout | Ivr-Version | `pages/PipelineOverview.jsx`, `features/pipeline/` StatStrip, PipelineStages, FollowUpsList, LeadsBySource, VisitAgenda, SellThroughMeter | **Adapt** layout; `services/api/stats.js` / `dashboard.js` bucket by fixed status slugs → rewrite against server aggregation. |
| Forms | Ivr-Version | `components/ui/FormField.jsx`, `features/leads/LeadFormModal.jsx`, `features/visitors/VisitorFormModal.jsx` | **Adapt**: FormField reusable; no form lib in IVR. Use controlled forms + shared zod-derived server errors (no new dep). |
| Filters / search | Ivr-Version | `pages/Leads.jsx` (435 l), `Segmented` | **Rewrite** to server-side params; keep filter-bar layout. |
| Pagination | Ivr-Version | `components/ui/Pagination.jsx` | **Reuse** (pair with server-side totals). |
| Detail pages / drawers | Ivr-Version | `features/leads/LeadDetailDrawer.jsx` (535 l), `features/deals/DealDetailDrawer.jsx`, `ui/Drawer.jsx` | **Adapt**: drawer shell + tabs idea; strip call/AI/score parts; feed from backend activity feed. Add full detail **pages** for Enquiry/Unit/Client. |
| Timeline / activity UI | Ivr-Version | `LeadDetailDrawer` timeline, `pages/ActivityLog.jsx` (module filter, search, 50/page), `features/activityLog/activityLogMeta.js` | **Adapt**: one reusable `<Timeline entityType entityId>` backed by `/activities`. |
| Status components | Ivr-Version | `features/leads/LeadStatusBadge.jsx`, `ui/Pill.jsx`, `features/sites/PlotStatusBadge.jsx` (master-driven with colour code via `usePlotStatuses`) | **Adapt** `PlotStatusBadge` pattern into one `<MasterBadge type code>` reading label+colour from masters cache. |
| Modals / drawers | Ivr-Version | `ui/Modal.jsx`, `Drawer.jsx`, `useDialogBehavior.js` (focus/esc handling) | **Reuse**. |
| Notifications | Ivr-Version | `hooks/useInAppNotifications.js` (30s poll + socket.io per mount, **unauthenticated**) | **Adapt**: poll only in V1 (no socket dep); optional authenticated shared socket later. |
| File upload | Ivr-Version | per-feature FormData in `features/deals/DealDocuments.jsx`, `sites/*` | **Rewrite** as one shared `<FileUploader>`; start from crackers `ImageUpload`. |
| Image handling | Ivr-Version | `ui/ImageLightboxModal.jsx` (zoom/rotate/pan) | **Reuse**. |
| Maps / location | Ivr-Version | `features/sites/PlotMapPickerModal.jsx` (Leaflet + OSM + Nominatim, no API key), `ui/GoogleMapsModal.jsx` (iframe) | **Reuse** picker for lat/long on Unit & Site Visit. (`leaflet` already a dep.) |
| Calendar | Ivr-Version | `features/meetings/MonthCalendar.jsx` (146 l), `MeetingAgendaList.jsx` (Today/Tomorrow/Week/Later) | **Reuse** for follow-up / site-visit calendar & grouping. |
| Follow-ups UI | Ivr-Version | `hooks/useFollowUps.js`, `services/api/followUps.js` (timeframe/status/search/paging/stats), `features/visitors/AddFollowUpDialog.jsx`, `AddNoteDialog.jsx` | **Adapt** API shape + dialog; skip `CallFollowUpsSection`. |
| Site visit UI | Ivr-Version | `pages/Visitors.jsx`, `features/visitors/*` | **Adapt** (visitor ≈ enquiry-with-visit). `visitorsMeta.js` hard-codes statuses → masters. |
| Units / plots UI | Ivr-Version | `features/sites/` PlotsTable, PlotFormModal (800 l), PlotDetailModal (956 l), PlotMapGrid, SiteCard | **Adapt selectively / rewrite** — large, coupled to site-layout mapper. BuildFlow units are top-level (no site hierarchy). Skip `SiteLayoutMapper`, `PlotLayoutViewer`. |
| Master data UI | Ivr-Version | `pages/MasterForms.jsx` (338 l) + `features/masterForms/masterFormsData.js` (config-driven columns/fields; text/select/dynamic-select) | **Adapt**: right idea, poor execution (mock state, per-entity hooks/API copies). Build one generic page + one generic hook against `/masters/:type`. |
| RBAC UI | Ivr-Version | `hooks/useRbac.js`, `features/rbac/RolePermissionMatrix.jsx` (177 l), `UserRoleAssignmentTable.jsx`; `ORIVIL/orivil-grocy/apps/admin/src/features/roles/{RolesPage,RoleFormModal}.tsx`, `layout/guards.tsx` | **Adapt**: matrix UI reusable but must be keyed by permission strings; **do not** copy `useMyPermissions.js` (fails open, matches role by name) or `app/roles.js`. UI reads permissions from login/`GET /auth/me`. |
| Reports UI | Ivr-Version | `features/reports/` SalesPerformanceReport, LeadSourceReport, SiteInventoryReport, `pages/Reports.jsx` | **Adapt** the three simple ones. |
| Import / export UI | Ivr-Version | `lib/csv.js` (`downloadCsv`), `lib/excelParser.js`, `features/leads/ImportLeadsDialog.jsx` (column auto-mapping; returns `{created,skipped,errors}`) | Export: **Reuse** `csv.js` (+BOM) but prefer server export. Import: out of V1 scope. |
| Formatting helpers | Ivr-Version | `lib/format.js` (en-IN INR, dates, relative time) | **Reuse**. |
| Query hooks | Ivr-Version | `hooks/use*.js` (one file per domain; array keys; invalidate on mutate) | **Adapt**; add a query-key factory. |
| Responsive / mobile | Ivr-Version | breakpoints ≈1180/900/768/640; sidebar→drawer; tables only scroll horizontally | **Adapt**; add card-list rendering of tables on <640px (sales execs are mobile). |
| Lint/test | Ivr-Version | `.oxlintrc.json`, one vitest-less test file | **Reuse** oxlint; add vitest. |

**Do not copy (frontend):** plan system (`config/planFeatures.js`, `PlanContext`, `usePlan`, `PlanSwitcherPill`, `hasFeature` gates); AI (`components/ai/FloatingAiCopilot`, `LeadSalesCopilot`, `LeadMemoryRag`, `leadScore*`, `callIntelligence/*`); dialer; WhatsApp flows/workflows/bulk (`features/whatsappWorkflows/*`, `features/calls/WhatsApp*`, `pages/TriggerBulkPage.jsx` 2941 l); calls (`pages/Calls`, `features/calls/*`); channels/Make; `services/api/mockData.js`, `agent.js`; attendance/backup/digest/security settings; `.env.*` files (also mis-located in `src/services/api/`).

**Hard-coded business values to make master-driven (must NOT be carried over):** `components/ui/leadMeta.js` (statuses/sources/urgency), `features/deals/dealsMeta.js` (stages, colours, won/lost by id), `services/api/adapters.js` (status/source alias tables), `services/api/stats.js` + `dashboard.js` (status buckets, 6-day constant), `masterFormsData.js` (unit types), `features/visitors/visitorsMeta.js` (follow-up statuses), `features/payments/paymentMeta.js`, `meetingsMeta.js`, `activityLogMeta.js`.

## 2. Backend References

Verdict key: the "Port" column says what to take; "from" is the best source.

| Feature | Reference Project | Location | Reuse Strategy |
|---|---|---|---|
| Authentication | plot-management-node; grocy | `middlewares/authMiddleware.js` (JWT HS256, 7d; public-path allowlist); `ORIVIL/orivil-grocy/apps/api/src/middleware/authenticate.ts`, `modules/auth` | **Rewrite from grocy**. plot's login has plaintext-password fallback, `x-user-id` header trust, magic code `EMP001` superadmin — never port. Use bcrypt only, access token + refresh. |
| Users / employees | plot; grocy | `models/masterModels/Employee.js`; `grocy/modules/users`, `departments` | **Adapt** grocy `users`; add unique email/code index. |
| Roles | plot; grocy | `RBAC.js`(RoleBased), `Role.js`; `grocy/middleware/authorizeGrocy.ts`, `modules/businessRules` | **Adapt** grocy dynamic-role model (role → `permissionKeys`, fall back to static map), `GET /auth/me/permissions`. |
| Permissions | plot; grocy; grolynk | plot: `{menuId,isAdd,isEdit,isView,isDelete}` **stored but never enforced server-side**; grolynk `packages/shared/src/capabilities.ts`, `authorize.ts` | **Rewrite**: permission-string keys (`enquiries.view`), enforced by `authorize('x.y')` middleware on every route. Keep plot's per-user override idea (`UserRights.js`) as optional grants/denials. |
| Branch / company scope | grocy; grolynk; crackers | `grocy/modules/branches`, principal carries `roleId`,`branchId`; `grolynk/middleware/authorize.ts` `assertStoreScope(principal, storeId)`; crackers branch-scoped stock/transfers | **Adapt**. plot has **no** scope enforcement (scope read from request body). BuildFlow: scope injected from principal at the repository layer. |
| Clients / people | plot | `Leads.js`, `Visitor.js` (mobile not unique), `leadDistribution`; import normalises to `91`+10 digits | **Rewrite**: `Person` with normalized unique phone; `Client` extends person. Reuse only the normalisation idea. |
| Enquiries (leads) | plot | `models/masterModels/Leads.js` (270 l), `LeadControllers.js` (2225 l) | **Adapt schema, rewrite controller**. Issues found: no index on phone/assignee/status; embedded unbounded history; any→any status moves; soft-delete via status; search `$or` bug lets agents see all; no export. |
| Workflow / stage transitions | grolynk; plot | `grolynk/modules/orders/order.stateMachine.ts` (TRANSITIONS record → 409); plot `DealControllers.js` (`stageHistory[]`, mandatory note, `DealStageReason` master) | **Adapt** both: grolynk's guard shape + plot's history/reason; transitions derived from a master, not a constant. |
| Follow-ups | plot | `FollowUp.js` (status pending/completed/rescheduled/cancelled, priority, indexes), `FollowUpControllers.js`; `queues/scheduledJobs.js` `flagMissedFollowUps` (30 min, idempotent via `followUpMissedNotifiedAt`) | **Adapt**: model + idempotent missed-sweep. "Missed" derived at query time. Plot has 3 overlapping follow-up stores — BuildFlow uses exactly one collection. |
| Site visits | plot | `Visitor.js` (plots[] status, embedded follow-ups), `VisitorControllers.js` (838 l), `PlotTicket.js` (QR check-in), 15-min reminder + post-visit feedback jobs | **Adapt** state/idempotency design (`*SentAt`, `forDate`); rewrite model: SiteVisit with `unitIds[]`, lat/long. Post-visit **next-day follow-up** auto-creation is new. |
| Units / properties | plot | `Plot.js`, `Unit.js`, `Site.js`, `PlotControllers.js` | **Adapt Plot→Unit**: keep status master + hold fields; add `version`, branch, unique constraint, media[]; drop Site hierarchy/polygon layout. |
| Assignments | plot | `services/leadDistribution.js` (round-robin, **non-atomic** `nextUpIndex`) | **Adapt** only if auto-assign wanted; use atomic `$inc`. Add `AssignmentHistory` (not in plot). |
| Booking | plot / lms / grolynk / crackers | plot `updatePlotStatus` = check-then-save (**double-booking bug**); lms partial unique index `one_active_… WHERE status='ACTIVE'`; grolynk `findOneAndUpdate({qty:{$gte}}, {$inc,version})`; crackers `session.withTransaction` + `lib/mongoCapabilities.ts` + `lib/saga.ts` | **Rewrite** using: Mongo partial unique index on `{unitId}` where `status:'ACTIVE'` + conditional atomic claim + `withTransaction`; duplicate-key → `BookingConflict` record (409). |
| Referrals | plot | none (no referral module) | **Rewrite** (greenfield). |
| Activities / timeline | plot; grolynk | plot `Log.js`/ActivityLog (`actorId,module,action,entityId,changeField,oldValue,newValue`; 3 indexes; `recordActivity` swallows errors); grolynk `modules/activityLogs` (`logActivity()`, typed action enum, domain-event subscribers) | **Adapt**: grolynk service + plot fields; add `refs[]` multi-entity, branchId, metadata. |
| Documents | plot; crackers; lms | plot multer → local `lead_documents` served publicly (don't); crackers `modules/media/*`; lms `modules/storage/*` + `SubmissionAttachment` model | **Rewrite** with Cloudinary (see §3). |
| Notifications | plot; grolynk; grocy | plot `Notification.js` (+socket personal room, no index); grolynk `notification.service.ts`, `fcm.provider.ts` (provider abstraction); grocy in-app list | **Adapt**: persisted notification + `NotificationChannel` interface with only `InApp` implemented. |
| Audit logs | plot; grolynk | as Activities | **Adapt**; keep separate `AuditLog` (before/after) from `Activity` (human timeline). |
| Masters | plot; grocy | ~12 copy-paste master controllers (inconsistent delete, typos, no unique codes); `grocy/lib/simpleMasterData.ts`, `modules/units`, `departments`, `documentNumbers` | **Rewrite**: one generic masters module + registry. `documentNumbers` (format/reset period) **Adapt** for Enquiry IDs. |
| Search / filtering | plot | `DashBoardControllers.js`, `ReportControllers.js` aggregation shapes (`$group/$lookup/$project`; `rangeWindow()` current vs previous period; IST day bucketing) | **Adapt** aggregation shapes; **never** load whole collections to Node (plot does). |
| Export | plot; grolynk | plot: none; `grolynk/lib/csv.ts` | **Adapt** `csv.ts`; stream server-side, permission `*.export`, scoped. |
| Validation | grolynk/grocy | `middleware/validate.ts` + zod schemas | **Reuse**. plot has none. |
| Error handling | grolynk/grocy | `lib/appError.ts`, `asyncHandler.ts`, `respond.ts`, `middleware/errorHandler.ts`, `notFound.ts`, `requestId.ts` | **Reuse**. plot has no error handler. |
| Dashboard aggregations | plot | `DashBoardStats.js`, `DashBoardControllers.js` (1150 l) | **Adapt** shapes only. |
| Scheduled jobs | plot | `queues/scheduledJobs.js` (BullMQ repeatables, tz Asia/Kolkata, 3 attempts + backoff, jobId per job) | **Adapt** idempotency; use `node-cron` in a worker entry — no Redis in V1 (see architecture). |
| Attendance | plot | `Attendance.js` (unique day index) | Skip (not V1). |

## 3. Infrastructure References

| Concern | Reference | Location | Strategy |
|---|---|---|---|
| Env configuration | grocy / grolynk | `apps/api/src/config/env.ts` (zod; fail fast; list issues) | **Reuse** — but **remove credential-looking strings from error messages** (grolynk env.ts embeds them). Ship a real `.env.example` (plot `.gitignore`s it). |
| Database setup | grocy; crackers | mongoose connect in `index.ts`; `crackers/lib/mongoCapabilities.ts` (detect standalone vs replica set at boot) | **Reuse**; BuildFlow **requires** a replica set (Atlas or docker `--replSet`). |
| Transactions | crackers; samplevpsbackend | `inventory.service.ts` L340-420 `session.withTransaction` (+ saga fallback); samplevpsbackend `SalesControllers.js` manual start/commit/abort (no retry) | **Adopt** crackers' `withTransaction`; no saga fallback (we mandate replica set). |
| API structure | grocy | `modules/<name>/{routes,controller,service,schema,model,test}.ts` | **Reuse** convention. |
| Logging | grocy | `lib/logger.ts` (pino), pino-http, `requestId` | **Reuse**. (Adds `pino`, `pino-http`.) |
| Testing | grocy | `vitest` + `supertest` + `mongodb-memory-server`; `src/test/setupTestDb.ts` | **Reuse** (use `MongoMemoryReplSet` for transactions). plot/IVR have essentially none. |
| File storage / Cloudinary | crackers; lms | `crackers/apps/api/src/modules/media/` (`cloudinary.client.ts` only file touching SDK, provider interface + mock driver; `media.service.ts` upload/replace/deleteQuietly with rollback; `imageTypes.ts` magic-byte check, refuses SVG; `upload.middleware.ts`; `safeFetch.ts`; tests); `lms/apps/api/src/modules/storage/` (`type:"authenticated"`, signed URLs 300 s, never stored; asset-table fields: provider, key, resourceType, deliveryType, mime, size, nullable owner) | **Reuse crackers** for unit images/media (public delivery) + **adapt lms** for private documents (authenticated delivery, signed URLs). Server-side upload (no browser-signed upload anywhere in KK-Source). Production refuses to boot without credentials (keep). |
| Deployment config | crackers; grolynk | per-app Dockerfile + compose; `deploy/nginx.conf`; `docs/DOCKER-HOSTINGER-DEPLOYMENT.md`; grolynk `DEPLOYMENT.md`, `docs/15-Production-Checklist.md` | **Reuse** (Docker + nginx on VPS). **Not** plot's `vercel.json` (conflicts with workers/uploads). |
| Scripts | plot | `scripts/seedDashboardData.js` | **Adapt** for demo seed; seeds for masters/roles are new. Rest is AI/telephony → Skip. |
| Shared utilities | grocy; grolynk | `lib/counters.ts` (atomic sequences), `documentNumbers`, `lib/csv.ts`, `lib/respond.ts`, `packages/shared` (zod schemas shared by API+UI) | **Reuse**; shared zod package optional (V1: skip, avoid monorepo tooling). |
| Backup | grolynk | `modules/backup` (Google Drive) | Skip V1. |
| Security notes | all | plot server.js & `utils/supabaseClient.js`, samplevpsbackend/agri `server.js`: **hard-coded DB credentials**; a Firebase admin JSON is committed under `ORIVIL/grolynk/apps/api/` | **Do not copy; recommend rotating those credentials.** |

## 4. Summary: what NOT to copy

1. Everything IVR/telephony/AI/WhatsApp-sending/Make/Zoom/dialer/plan-gating (~half of both codebases).
2. plot-management-node's route style (276 POST RPC routes), 1000–2200-line controllers, role-name admin checks, unenforced permissions, request-body data scope, plaintext password fallback, `x-user-id` auth, unauthenticated socket rooms, public upload dir, debug routes, non-atomic booking, whole-collection dashboards, status-by-display-name matching, soft delete via status, copy-pasted master controllers, hard-coded ObjectIds (`defaultMenu.json`).
3. IVR's client-side pagination/filtering, fail-open permissions, POST-only client, per-entity master hooks, mock data, hard-coded status/source lists.
4. `xlsx@0.18.5` (known vulns; V1 has no import, export is CSV).
5. Any hard-coded connection strings / service-account files.
