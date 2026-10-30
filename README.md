# Muniyasamy Laundry platform

This project keeps the existing public HTML/CSS/vanilla-JS marketing website and provides the customer/admin portal as a React + Vite application, backed by the existing Express JSON API and MongoDB persistence. The original portal HTML/CSS/JavaScript is retained as a rollback reference while the React portal is verified.

## Requirements and local setup

- Node.js 20 or newer and npm
- MongoDB Community Server running locally, or a MongoDB Atlas database

1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI` to your local database or Atlas connection string.
3. Generate a unique random `JWT_SECRET` of at least 32 characters. Keep `.env` out of source control.
4. Run `npm install`.
5. Run `npm run dev:all` to start the frontend and backend together. Open the public website at `http://localhost:5173/` and the React portal at `http://localhost:5173/portal/`. Vite proxies `/api` calls to the Express backend port from `PORT` (or `VITE_DEV_API_TARGET`), so the browser stays on the frontend port. If `PORT` is unset, Express uses `4000`; this workspace's `.env` currently sets it to `5500`.

`npm run dev` starts only Vite on port `5173`; run `npm run dev:server` in a second terminal for the Express API. `npm run dev:all` starts both. To preview the production-style same-origin setup locally, use `npm run build:client` and then `npm start`; open `http://localhost:<PORT>/` for the public website and `http://localhost:<PORT>/portal/` for the React portal.

Do not open `index.html` or `portal.html` by double-clicking it (`file://`). The portal needs the Express origin for its `/api` calls and session cookie. If opened as a file, it now displays the correct local-server steps instead of submitting a broken file URL.

The application creates default laundry services and business settings on first connection when no service catalog exists. Prices and service availability are editable by an authenticated admin; an order stores the applied service and price snapshot so later price edits do not change past quotes.

## Create the first admin

The server never creates a privileged account from a default or committed password. With the server environment configured and a trusted interactive terminal, run `npm run admin:create`. The command prompts for the admin name, email and phone, then reads the password without echoing it. It refuses an existing account and hashes the new password with bcrypt. For a hosted deployment, run the same command in the deployment environment or use a controlled one-time administrative provisioning process. Public registration only creates customer accounts.

## Workflows

- Customer account registration, login, logout and profile/address management.
- Public service catalogue is loaded from the same `/api/services` endpoint used by the booking portal; it never hardcodes a second price list.
- Pickup booking using weight or item pricing, configured services, pickup slots, saved price breakdowns and optional coordinates.
- Customer order history/details, edits while a booking awaits confirmation, eligible cancellation, printable receipts, map links and in-app status notifications.
- Admin metrics, order search/filtering/pagination, workflow status changes, cancellation/rejection reasons, CSV export, service and business settings, customer lookup, contact inbox/archive/reply, and audit history.
- Status flow: booking received → pickup scheduled → picked up → processing → ready for delivery → out for delivery → delivered. Cancellation/rejection is allowed only before pickup. API transitions are checked on the server.
- Revenue totals include only orders with `paymentStatus: paid`. There is no payment integration or endpoint that can mark an order paid without provider evidence.

## Commands and tests

- `npm run dev` — Vite frontend at `http://localhost:5173/`
- `npm run dev:server` — Express API/backend on `PORT` (5500 in this workspace)
- `npm run dev:client` — alias for the Vite frontend command
- `npm run dev:all` — Vite frontend and Express backend together
- `npm run build:client` — optimized React production build into `client/dist`
- `npm run preview:client` — preview the production build with Vite
- `npm start` — production server
- `npm run admin:create` — securely provision an admin interactively
- `npm test` — Node's built-in automated test runner

The automated tests cover domain pricing/status rules and real HTTP API behavior against a disposable, process-specific local MongoDB database. They exercise authentication, admin authorization, customer record isolation, CSRF origin checks, booking pricing/idempotent retries, atomic pickup capacity under competing bookings, workflow transitions, in-app notifications, audit logging, paid-only revenue, and the customer inbox. The integration suite drops only its explicitly named test database on completion.

## Environment configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port (default `4000`) |
| `MONGODB_URI` | Yes to start | Local MongoDB or Atlas URI |
| `JWT_SECRET` | Yes | Random session signing secret, minimum 32 characters |
| `CLIENT_ORIGIN` | Yes in production | Exact HTTPS origin of the deployed app (scheme + hostname, no path), e.g. the HTTPS origin assigned by your host. Multiple comma-separated origins are supported when deliberately serving more than one frontend. |
| `NODE_ENV` | No | Set to `production` to enable secure cookies and production static caching |
| `TRUST_PROXY_HOPS` | Yes in production | Number of trusted reverse proxies in front of Express (1–5 in production, 0 locally). Set only to match the actual hosting topology so Express can safely read the original HTTPS protocol and client IP. |
| `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_API_KEY` | No | Optional authenticated HTTPS webhook for email notifications |
| `SMS_PROVIDER_URL`, `SMS_PROVIDER_API_KEY` | No | Optional authenticated HTTPS webhook for SMS notifications |

`GET /api/health` reports application and database connection state without returning configuration values. The server uses HTTP-only, SameSite cookies, per-request account/role lookup, origin checks for browser writes, authentication/message rate limits, input constraints, admin-only server authorization, MongoDB query indexes, a restrictive Content Security Policy with hashes for structured data, a public asset allowlist, sanitized errors, and structured error event logs. Pickup capacity is reserved atomically so competing requests cannot take the same final slot.

## Deployment and remaining work

Deploy one Node/Express web service with a persistent MongoDB database. For Render, create a Web Service from this repository with build command `npm ci && npm run build:client` and start command `npm start`. Set these environment values in the host dashboard (never commit production secrets):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Production MongoDB Atlas URI; allow the hosting service to connect in Atlas Network Access. Do not use localhost. |
| `JWT_SECRET` | Unique cryptographically random secret of at least 32 characters. |
| `CLIENT_ORIGIN` | Exact HTTPS origin shown for this deployed service, or the eventual custom-domain origin; no path or trailing slash. The deployment will fail fast if this is missing or not HTTPS. |
| `TRUST_PROXY_HOPS` | Set to the verified proxy hop count. For a Render Web Service, configure `1` for its HTTPS-terminating load balancer; for another host, follow that host's topology. Do not set broad proxy trust. |

The host supplies `PORT`; Express binds to `0.0.0.0`, connects MongoDB before accepting requests, and closes the server/database on shutdown signals. Express requires an explicit trusted proxy count in production because forwarded protocol and client-IP headers affect same-origin checks and rate limiting. For Render, the load balancer terminates HTTPS before forwarding traffic, so configure one trusted hop. Use the host's HTTPS URL initially; no custom domain is assumed here. After assigning a custom domain, configure DNS and HTTPS with the host, then update `CLIENT_ORIGIN` to that exact origin and redeploy.

The single-domain routes are `/` for the public website, `/portal/` for customer sign-in, `/portal/admin` for admin sign-in/overview routing, `/portal/customer` for customer sign-in/overview routing, and `/api/*` for the existing JSON API. The public homepage catalogue uses the live configured service list and links into customer booking. Admin overview counts orders created on the current India calendar day and future non-terminal pickups; paid revenue includes only orders marked paid. After login, role checks route users to their dashboard. The server serves the React build only on recognized portal paths and built assets, preserves public marketing pages/assets, returns JSON 404s for unknown API endpoints, and returns 404 for unknown pages/assets. Same-origin hosting retains the HTTP-only SameSite session cookie; production cookies are Secure.

The old Melbourne location and blog HTML files remain in the repository as source artifacts but are not routed by the Express or Vite development server because their business details belong to an unrelated business. The previous sitemap referenced an unowned domain and is not published; add a sitemap only after the production hostname is known. `robots.txt` excludes the authenticated portal and API routes.

Before announcing the site, check `/`, `/portal/`, `/portal/admin`, `/portal/customer`, `/api/health`, an unknown `/api/*` URL, and an intentionally missing static asset. Confirm the health response reports `database: connected`, create the first admin with `npm run admin:create` in a secure deployment shell, then test customer registration, login, booking, map links and messages plus admin inbox/order management. Configure and verify Atlas network access, actual pickup capacity/prices, and the host proxy hop count. The service health route does not replace provider-side monitoring or database backups.

GitHub Pages cannot run this Express backend. To meet the single-domain requirement, point the public website and customer/admin portal at this Express deployment (and move the public site to the same host/domain). A GitHub Pages frontend plus a separate API host is a different, cross-origin deployment and is not the documented setup for the existing SameSite cookie session.

Migration scope and feature mapping are tracked in [docs/react-portal-migration-checklist.md](docs/react-portal-migration-checklist.md).

In-app notifications work without external credentials. When configured, the email/SMS adapter sends an authenticated JSON webhook with recipient and message details; the endpoint must be a real provider adapter that returns a successful HTTP response. Without credentials the app skips external delivery and keeps the in-app message. Payments and customer password recovery still need provider integrations. Verify the configured pickup hours, capacity, prices and webhook behavior against the business before taking live bookings. No payment is recorded as paid by this app.
