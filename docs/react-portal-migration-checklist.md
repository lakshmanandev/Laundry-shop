# React + Vite Portal Migration Checklist

This checklist records the existing portal contract before migration. The legacy `portal.html`, `portal.js`, and `portal.css` stay available until the React build and regressions have been checked.

## Inspection baseline

- [x] Inventory repository files, root scripts, current backend/test files, and static marketing pages.
- [x] Read the complete portal HTML, JavaScript, stylesheet, API route declarations, Mongo models, and domain rules.
- [x] Confirm the portal is one role-aware UI: customers and admins share authentication/shell but see role-specific features.
- [x] Confirm cookie session name/HTTP-only behavior, `/api` same-origin contract, backend role checks, and database persistence.
- [x] Confirm Express currently serves root marketing pages and the legacy portal; production must preserve marketing routes and route `/api/*` before any SPA fallback.
- [ ] Capture original desktop/mobile screenshots. Browser screenshot tooling is not configured in this workspace; visual verification will be described honestly if it remains unavailable.

## Existing design system to preserve

- Palette tokens: navy `#102f4a`, blue `#2375c8`, ink `#172b40`, muted `#75869a`, line `#e6edf3`, pale `#f4f8fc`, green `#298861`, orange `#d78437`.
- Typography: DM Sans for body/UI; Manrope for headings and brand; Google Fonts stylesheet in the legacy HTML.
- Visual patterns: fixed 258px white desktop sidebar (220px at <=1050px), 1600px main content max, blue gradient welcome card, white rounded cards, thin blue-gray borders, understated shadows, blue primary buttons, compact status badges, pill-like navigation counts, modal overlays.
- Existing responsive breakpoints: 1050px and 740px. At <=740px the sidebar becomes a top bar, navigation scrolls horizontally, main gutters shrink, cards/forms collapse and message tools wrap.
- Keep customer/admin branding, copy, ordering, card/form/table treatment, map links, focus rings, and shared shell consistent. Existing CSS is the visual source of truth; import/refactor it instead of applying a dashboard kit.

## Customer UI and behavior map

- [x] Sign-in/create-account tabs, registration name/phone fields, API errors, busy state, logout, and persisted cookie session.
- [x] Customer overview metrics/recent orders and pickup/message calls to action.
- [x] New pickup: service catalog, quantity/unit rules, date/time-slot lookup, address, optional geolocation, price estimate, notes, duplicate-submit/idempotency protection, confirmation.
- [x] Order history pagination, detail modal, status history, map links, printable receipt, edit while awaiting confirmation, and eligible cancellation with reason.
- [x] Profile/contact/address save and optional current location.
- [x] Notifications/unread state, mark-read behavior, periodic refresh cleanup, customer message history, new message/replies.
- [x] Loading, empty, success, validation, expired-session, and API failure states.

## Admin UI and behavior map

- [x] Admin login/logout and role-gated client routes; server API authorization remains authoritative.
- [x] Overview metrics including paid-only revenue and unread inbox count.
- [x] Order queue search/status/service/payment/date filters, sort direction, pagination, CSV export, detail and customer details.
- [x] Server-validated status workflow/history, cancellation/rejection reasons, final quote management, payment remains unpaid unless a verified payment integration exists.
- [x] Service catalog/pricing editor and business pickup settings (fee/minimum/order hours/capacity/duration/days).
- [x] Customer search, customer order history, customer message inbox folders/read/archive/reply, audit log.
- [x] Responsive admin controls, usable cards and dialogs; preserve desktop sidebar and mobile horizontal nav behavior.

## Backend/API contracts identified

- [x] Public/auth: `GET /api/health`, `GET /api/services`, `GET /api/pickup-slots`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- [x] Customer: `GET/PATCH /api/profile`, `GET/POST /api/orders`, `GET/PUT /api/orders/:id`, `PATCH /api/orders/:id/cancel`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `GET /api/my-messages`, `POST /api/messages`.
- [x] Admin: `GET/POST /api/admin/services`, `PATCH /api/admin/services/:id`, `GET/PATCH /api/admin/settings`, `PATCH /api/orders/:id/status`, `PATCH /api/orders/:id/quote`, `PATCH /api/orders/:id/payment`, `GET/PATCH /api/messages`, `GET /api/admin/overview`, `GET /api/admin/orders.csv`, `GET /api/admin/customers`, `GET /api/admin/customers/:id/orders`, `GET /api/admin/audit`.
- [x] Persistence: User, Service, Order, Message, Notification, AuditLog, BusinessSettings, PickupReservation. The backend enforces customer isolation, admin roles, status transitions, quote rules, and unique slot/idempotency constraints.
- [x] Add a centralized React API client with same-origin `/api` by default, `credentials: include`, JSON/error handling, and an optional `VITE_API_BASE_URL` for separately hosted frontend mode. Never pass secrets through Vite variables.

## Implementation, routing, and verification

- [x] Add a JavaScript/JSX React + Vite client without changing backend framework or API contracts.
- [x] Implement customer/admin screens using declarative React state; React-rendered UI does not use `innerHTML` or imperative event listeners.
- [x] Reuse the original stylesheet and add narrowly scoped responsive/focus/modal adjustments for the portal.
- [x] Keep legacy portal files as a rollback path; serve built SPA only on recognized `/portal/*` screens and build assets, redirect legacy `/portal.html`, preserve public pages/assets, and return proper 404s for missing static/portal paths and JSON for unknown `/api/*` routes.
- [x] Route `/portal/admin` and `/portal/customer` to their role dashboards; gate all portal roles again on the server API.
- [x] Support Vite development API proxy and Express production static build on the same origin; document both.
- [x] Validate production environment (HTTPS origin, remote MongoDB, explicit trusted proxy hops), bind the deployment port on `0.0.0.0`, and close HTTP/MongoDB connections on process shutdown.
- [x] Run frontend production build, JavaScript syntax checks, and existing backend unit/integration suite.
- [x] Smoke-check Express portal entry/routes, React asset and missing-file behavior, legacy redirect, public root, health endpoint, API 404 routing, and `.env` denial.
- [ ] Browser interaction, visual comparison, direct refresh and viewport QA remain for manual verification because browser automation/screenshot tooling is unavailable in this workspace.
- [ ] Configure the eventual production host's actual `CLIENT_ORIGIN`, `TRUST_PROXY_HOPS`, MongoDB network access, custom domain/DNS/TLS, and first admin account.
- [x] Update root scripts, `.gitignore`, README, and deployment notes; existing tests were preserved.
- [ ] Only remove/deactivate legacy frontend after the React production build and behavior are verified. Keep an explicit rollback path.
