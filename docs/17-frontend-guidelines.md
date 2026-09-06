# 17 — Frontend Guidelines (Vite) — to be executed after the backend

The frontend is a separate app (`apps/web`) that consumes only the documented REST API and
socket contract. These rules keep it aligned with the backend design.

## 1. Stack & structure

- Vite 7, React 19, TypeScript strict, TanStack Router (file-based routes), TanStack Query (server state), Zustand (tiny UI state: popup stack, sidebar), Tailwind v4 + shadcn/ui, react-hook-form + Zod from `packages/shared`, `socket.io-client`, `better-auth/react` (`createAuthClient` with `adminClient()`, `twoFactorClient()`), `openapi-typescript` generated types from the backend OpenAPI export.
- Folders: `src/app` (shell, providers, router), `src/features/<domain>` (mirrors backend modules), `src/components/ui` (shadcn), `src/lib` (api client, socket, formatters), `src/widgets/call-popup`, `src/widgets/chat-dock`.

## 2. App shell & persistent widgets (R-3.1)

- `AppShell` renders `<Sidebar/>`, `<Topbar/>`, `<Outlet/>`, and **outside** the router outlet: `<CallPopupHost/>`, `<ChatDock/>`, `<NotificationToaster/>`, `<PbxStatusBanner/>`. They survive navigation.
- Popup stack supports multiple simultaneous calls (queue rings); newest on top; each card shows: caller display + number, contact/company/avatar, last 5 activities, and the actions from the `capabilities` payload (Answer, Decline, Open profile, Note, Task, Disposition). Unknown caller → "Create contact" prefilled.
- State machine in the UI mirrors backend events: `ringing → answered → ended → logged(disposition form) → closed`; `cancelled` removes the card with a short toast.
- Timer starts at `answeredAt` from the server (not local time). Latency is measured client-side (`Date.now() - payload.at`) and sent as a beacon for the pop-latency metric.

## 3. Data & realtime

- Every list uses TanStack Query with the backend's cursor/offset shape; invalidate on `entity:changed` for currently watched entities and on the domain socket events (`call:logged` → invalidate contact timeline).
- Optimistic updates only for low-risk actions (task complete, note create); stage changes wait for the server (history + permissions).
- Reconnect logic: on socket `connect`, refetch `calls?status=ringing|answered&mine=true` and unread notifications.
- Never trust client permissions for security — the UI hides actions based on `GET /users/me` permissions, the server enforces.

## 4. UX rules

- Responsive ≥ 768 px (tablet) — sidebar collapses; popup becomes a bottom sheet.
- Keyboard: `Esc` closes popup, `Enter` submits disposition; call popup is focus-trapped only while ringing.
- Timeline: virtualized list, type filter chips, search box (`q`), infinite cursor scrolling.
- Kanban with `@dnd-kit`; drop → `POST /deals/:id/stage`; failure reverts.
- Phone numbers rendered in national format with E.164 in a tooltip; click-to-call button next to every phone (disabled if user has no extension, tooltip explains).
- Forms: Zod schemas shared with backend; server `422 details[]` mapped to field errors by `path`.
- Dates shown in the user's timezone (`users.timezone`).

## 5. Security in the browser

- No tokens in `localStorage`; auth is cookie-based; `fetch` with `credentials: 'include'`.
- CSP-compatible: no inline scripts; no third-party CDNs; assets self-hosted.
- Recording playback uses presigned URL or same-origin stream with `<audio>`; no download button unless permission `call:export`.
- Idle logout after 60 min inactivity (warn at 55) — client-side complement to the server's 12 h cap.
- Error boundary reports to the logger endpoint without PII.

## 6. Optional WebRTC (Linkus SDK)

- If `capabilities.answer === 'webrtc'`, the shell initializes `ys-webrtc-sdk-core` once per session with the sign from `POST /cti/linkus-sign`; microphone permission requested lazily on first answer; SDK incoming events are matched to popup cards by `pbxCallId`; audio device selection in settings.

## 7. Implementation notes (added 2026-09-05, matches apps/web)

- Dev server proxies `/api`, `/socket.io` and `/public` to the api (`vite.config.ts`), so the app is same-origin in dev and prod alike; `APP_URL`/`DEV_ORIGINS` already allow `http://localhost:5173` and `http://127.0.0.1:5173`.
- API types are generated: `pnpm openapi:export` then `pnpm openapi:types`; the client is `openapi-fetch` with a middleware that turns every non-2xx into `ApiError` and notifies a single 401 handler.
- Route guard: `src/routes/_app.tsx` loads `GET /users/me` before render; 401 → `/sign-in?redirect=`, `TWO_FACTOR_REQUIRED` → `/two-factor?setup=true`. `safeRedirect()` accepts only same-origin paths.
- Realtime: one socket per tab, opened by `AuthenticatedRuntime` after `me` resolves; call events feed `features/calls/call-store.ts`, `entity:changed` and `call:logged` invalidate the matching query keys (`lib/query.ts` `qk`).
- Idle logout: 55 min warning, 60 min sign-out, activity shared across tabs through localStorage (`lib/idle.ts`).
- Theme: `data-theme` on `<html>`, dark by default, tokens in `src/styles/tokens.css` exactly as docs/18; Tailwind utilities map to those tokens only.
