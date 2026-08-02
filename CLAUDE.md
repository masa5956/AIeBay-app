# CLAUDE.md

Guidance for Claude Code when working in this repo. Written in English for token efficiency; you must still always reply to the user in Japanese (see below).

## Language rule
常に日本語で会話・コメント・エラー説明・ドキュメントを記述する。(Always respond, comment, and write docs in Japanese — this rule itself stays in Japanese since it defines that policy; the rest of this file is English purely to save tokens.)

## Overview

eBay AI auto-listing tool. Phone-style React SPA: user photographs a product, Gemini/Groq (vision) extracts listing data, multiple AI agents (market trend, competitor comparison, condition) analyze it, then a wizard publishes to eBay. **Multi-user**: app has its own Supabase Auth (email+password) accounts; listings, sales, and connected eBay accounts are isolated per user. Full spec: [PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) (implementation differs — see bottom).

## Commands

```bash
npm run dev            # Vite dev server (frontend only)
npm run server         # Express backend (server/index.js), needs .env, separate terminal
npm run build           # tsc → vite build
npm run preview         # preview production build locally
npm run lint            # oxlint
npm run setup:policies  # one-time eBay Business Policies / location setup
```

Need both `dev` and `server` running for the listing flow to work. No test framework configured.

## Architecture

### Frontend

Vite + React18 + TS + Tailwind + `lucide-react` + `recharts`. [App.tsx](src/App.tsx) is a thin shell (state + composition); screens live in [src/components/](src/components/). `AnalyticsPanel`/`ListingDetailModal` are `React.lazy`-loaded (recharts alone is ~100KB gzip, kept out of the initial bundle).

| Component | Notes |
|---|---|
| [AuthScreen.tsx](src/components/AuthScreen.tsx) | Login/signup (Supabase Auth). Shown alone when logged out. |
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | `getListings()` for sales summary + recent listings (refetched on mount and after publish). Shows skeleton while `isLoading` instead of flashing zero values. |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | `getAnalytics()` → monthly trend + category breakdown charts. |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | `getEbayStatus()` shows Sandbox/Production connection state + active env. Tab picks which env; shows "eBayでログイン" (`getEbayAuthUrl(env)`) if disconnected, "切り替える" (`setActiveEbayEnv(env)`, behind a confirm dialog) if connected-but-inactive. Also mock-analysis toggle, logout. |
| Step1_ImageUpload → Step4_Preview | Wizard: photograph → review/edit AI result → price → confirm. Up to `MAX_PHOTOS`=8 photos. **Step1 does not auto-analyze on file pick** — shows thumbnails with per-photo remove (×) and an "追加" (add more) tile first; analysis only starts when the user taps "この写真で解析する" (`onConfirm(files)`). Step2's "追加" button appends to the original file set (`App.tsx`'s `selectedFiles`) and re-runs `runAnalysis()` over *all* photos so AI can re-synthesize with the new angle. [StepperHeader.tsx](src/components/StepperHeader.tsx) handles step nav (Step2+ blocked until analysis exists). |
| [ListingDetailModal.tsx](src/components/ListingDetailModal.tsx) | Opens from a recent-listing tap; `getListingDetail(id)`. |
| [Toast.tsx](src/components/Toast.tsx) / [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx) | Success/error toast / cancel-listing confirm. |
| [BottomNav.tsx](src/components/BottomNav.tsx) | Home/Analytics/Settings tabs. |

- **Auth**: [supabaseClient.ts](src/services/supabaseClient.ts) uses only the publishable/anon key. `App.tsx` watches `supabase.auth.getSession()`/`onAuthStateChange()`. All data access goes through the backend, never this client directly (`listingService.ts` attaches `Authorization: Bearer <access_token>` to every request).
- **Types**: [types/listing.ts](src/types/listing.ts) (`ProductData` — `imageUrls: string[]`, multi-photo — `Condition`, AI analysis results), [types/app.ts](src/types/app.ts) (`TabType`, `RecentListing`, `ListingDetail`, `SalesSummary`, `AnalyticsData`, `EbayEnvironment`, `EbayStatus`).
- **API client**: [listingService.ts](src/services/listingService.ts) — `analyzeImageWithAI(files: File[])`, `estimatePrice`, `publishToEbay`, `getListings`, `getAnalytics`, `getListingDetail`, `getEbayAuthUrl(env)`, `getEbayStatus`, `setActiveEbayEnv(env)`, all hitting the backend (default `http://localhost:3001/api`, override via `VITE_BACKEND_URL`). `mockAnalyzeImage`/`mockPublishItem` ([mock/mockData.ts](src/mock/mockData.ts)) back the dev mock toggle.

### Backend

[server/index.js](server/index.js) (Express, `npm run server`, needs `.env`). Every route except `/api/ebay/callback` and `/api/ebay/deletion-notification` goes through [authMiddleware.js](server/authMiddleware.js)'s `requireAuth` (verifies the Supabase access token → `req.userId`, else 401). CORS is restricted to `ALLOWED_ORIGINS` + `localhost:5173` + a regex covering `https://a-ie-bay-app*.vercel.app` (production/branch/preview Vercel URLs). Image upload capped at 10MB, `image/*` only (multer). Any user input echoed into an HTML response is passed through `escapeHtml()`.

| Method / Path | Notes |
|---|---|
| `POST /api/analyze-image` | Accepts 1–8 images (`multipart/form-data`, field `images`). Sends all images in one call to Gemini/Groq for a single combined title/brand/model/condition/description/aspects JSON. Runs `runConditionAgent` (also multi-image) and `uploadProductImage` (all files) via `Promise.all`; returns `imageUrls[]`. |
| `POST /api/estimate-price` | Browse API search → IQR outlier removal → market-trend/competitor agents → deterministic score (`scoreListing`). **Search always hits PRODUCTION Browse API when `EBAY_PRODUCTION_CLIENT_ID` etc. are set, regardless of the user's active publish env** — Sandbox has almost no real inventory, so real product searches return 0 hits there and price was always $0 (confirmed: same query → 0 results in Sandbox vs 1644 in Production). Falls back to the active env only if Production isn't configured. Even with 0 comparable listings, market-trend/competitor/score are still computed (never short-circuits to a bare zero response). The market-trend/competitor AI calls are wrapped in their own try/catch — if the text AI provider fails (e.g. bad/missing `GROQ_API_KEY` when `TEXT_AI_PROVIDER=groq`), the already-computed price stats are still returned instead of the whole endpoint failing. |
| `POST /api/publish-ebay` | Uses `ebay_connections`' Business Policy IDs + location via Sell Inventory API (Item→Offer→Publish). `productData.imageUrls` passed straight through as eBay's `product.imageUrls` (non-http(s) entries dropped; placeholder image if none valid). Fills required Item Specifics (Brand/Color/Connectivity/Model/Type, fixed `categoryId=112529`) with defaults. **Condition** is resolved via `CONDITION_INFO` (app's 4-tier NEW/USED_EXCELLENT/USED_GOOD/USED_FAIR → real eBay `ConditionEnum`+numeric id; `USED_FAIR` isn't a real eBay enum, mapped to `USED_ACCEPTABLE`), then checked against that category's actual allowed conditions via Sell Metadata API `get_item_condition_policies` and swapped to the closest allowed candidate if unsupported (category `112529` only allows NEW/NEW_OTHER/USED_EXCELLENT/FOR_PARTS_OR_NOT_WORKING in production — `USED_GOOD` used to get rejected with errorId 25021). Saves history via `saveListing()` (own history table stores one cover image, `imageUrls[0]`). |
| `GET /api/listings` | Own recent listings + sales summary. |
| `GET /api/listings/:id` | Full row incl. description/aspects. |
| `GET /api/analytics` | Monthly trend (6mo) + category breakdown. |
| `GET /api/ebay/auth-url` | `?env=SANDBOX\|PRODUCTION` (default SANDBOX). `state` = a one-time nonce from `createOAuthState()`, not a raw userId. |
| `GET /api/ebay/callback` | Public. `consumeOAuthState(state)` burns the nonce once to recover userId/env, then `exchangeAuthCodeForTokens`→`getEbayUsername`→`setEbayConnection`→`setActiveEbayEnv`→`setupEbayPoliciesForToken()`. `error` query param is HTML-escaped (was a reflected-XSS hole). |
| `GET /api/ebay/status` | Both envs' connection state (+ `ebayUsername`) and `activeEnv`. |
| `POST /api/ebay/active-env` | Instant switch to an already-connected env (`{ environment }`, 400 if not connected). No restart needed. |
| `GET,POST /api/ebay/deletion-notification` | Public. GET = challenge_code handshake. POST verifies `x-ebay-signature` via `verifyEbayNotificationSignature()` before deleting the matching `ebay_connections` row (bad signature → 412; infra failure while verifying → fail-open + log, so a real deletion notice is never silently dropped). `deleteEbayConnectionsByUsername()` returns the actual deleted row count so the log accurately says "no connection found" vs "disconnected" (a notified username with zero matching rows — e.g. eBay's own test notifications — is not an app bug or a data leak from unrelated users). |

#### Backend modules

| File | Role |
|---|---|
| [authMiddleware.js](server/authMiddleware.js) | `requireAuth` — verifies Supabase token → `req.userId`. |
| [aiProvider.js](server/aiProvider.js) | `AI_PROVIDER` (`gemini`/`groq`) picks the vision engine; `TEXT_AI_PROVIDER` (defaults to `AI_PROVIDER`) independently picks the engine for text-only agents. Exports `generateImageJson(promptText, images)` (vision) and `generateJson()` (text). `images` = `[{base64Image, mimeType}, ...]`. Setting `TEXT_AI_PROVIDER=groq` cuts Gemini calls per listing from 4→2 (market-trend/competitor agents need no vision). |
| [analysisAgents.js](server/analysisAgents.js) | `runConditionAgent(images)`, `runMarketTrendAgent`/`runCompetitorAgent` (always run, even with 0 comparable items), `scoreListing` (deterministic, no LLM). |
| [priceStats.js](server/priceStats.js) | `removeOutliersByIQR()`. |
| [ebayAuth.js](server/ebayAuth.js) | `getEbayEnvConfig(environment)` resolves baseUrl/authUrl/credentials per `'SANDBOX'`/`'PRODUCTION'` (`EBAY_SANDBOX_*`/`EBAY_PRODUCTION_*`). All token functions take `environment` explicitly and are cached via [ebayTokenCache.js](server/ebayTokenCache.js) (`expires_in`-based, skips redundant refresh round-trips — cache hit ~0ms vs ~350ms). `USER_SCOPES` (used on every refresh-grant call) vs `AUTH_SCOPES` (consent-screen only, adds `commerce.identity.readonly`) are deliberately separate — merging them would break existing connections' token refresh with an unconsented-scope error. |
| [ebayConnectionsRepository.js](server/ebayConnectionsRepository.js) | `ebay_connections` CRUD, all functions require `environment` (one user can hold both Sandbox + Production connections). |
| [userSettingsRepository.js](server/userSettingsRepository.js) | `user_settings` — `getActiveEbayEnv`/`setActiveEbayEnv` (default `'SANDBOX'`). |
| [setupPolicies.js](server/setupPolicies.js) | get-or-create Business Policies/location, bundled as `setupEbayPoliciesForToken(token, environment)`. Also runnable standalone via `npm run setup:policies`. |
| [envFile.js](server/envFile.js) | `.env` rewriting, local `setup:policies` only. |
| [supabaseClient.js](server/supabaseClient.js) | `service_role` client; `null` if unconfigured (degrades gracefully, doesn't crash the server). |
| [listingsRepository.js](server/listingsRepository.js) | `listings` CRUD, all scoped by `userId`. `getRecentListings` selects only list-view columns (skips `description`/`aspects` to cut payload size). |
| [ebayTokenCache.js](server/ebayTokenCache.js) | In-memory app/user access-token cache. |
| [oauthStateStore.js](server/oauthStateStore.js) | One-time, 10-min-TTL random nonce store for OAuth `state` (`createOAuthState`/`consumeOAuthState`) — prevents the account-linking CSRF you'd get from using a predictable `userId:environment` as `state`. |
| [ebayNotificationVerifier.js](server/ebayNotificationVerifier.js) | Verifies `x-ebay-signature` against eBay's public-key API (tries Production then Sandbox), per [eBay's official Node SDK](https://github.com/eBay/event-notification-nodejs-sdk). Uses digest `'sha1'`, not the SDK's `'ssl3-sha1'` — the latter lives in OpenSSL's legacy provider and isn't available by default on Node 18+/OpenSSL 3.x. |

### Database (Supabase)

Postgres + Storage + Auth. Run in SQL Editor:

```sql
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  listing_id text not null,
  title text not null,
  price numeric not null,
  status text not null default 'ACTIVE',
  image_url text,
  category text not null default 'Other',
  description text,
  aspects jsonb,
  created_at timestamptz not null default now()
);

-- per user × environment (SANDBOX/PRODUCTION); one user can hold both simultaneously
create table public.ebay_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null default 'SANDBOX',
  refresh_token text not null,
  fulfillment_policy_id text,
  return_policy_id text,
  merchant_location_key text,
  ebay_username text, -- for matching account-deletion notifications
  updated_at timestamptz not null default now(),
  primary key (user_id, environment)
);

-- which env is currently active for each user (instant switch from Settings tab)
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_ebay_env text not null default 'SANDBOX',
  updated_at timestamptz not null default now()
);

-- backend always bypasses RLS via service_role, but enable it to block any direct-access path
alter table public.listings enable row level security;
alter table public.ebay_connections enable row level security;
alter table public.user_settings enable row level security;
```

Also create a **Public** Storage bucket named `product-images`.

**Auth setting**: Authentication → Sign In/Providers → Email → "Confirm email" ON = signup requires email confirmation (prod); OFF = instant login (dev).

## eBay integration setup

Sandbox/Production are switchable instantly from the Settings tab (one user can connect both at once; no restart/redeploy to switch). Production keyset is optional — Sandbox alone is fully functional.

**First-time connect** (per environment, once):
1. In eBay Developer Portal, create a keyset (`EBAY_SANDBOX_CLIENT_ID` etc. / `EBAY_PRODUCTION_CLIENT_ID` etc.) and RuName; set "Your auth accepted URL" to `https://<backend-url>/api/ebay/callback` (same URL works for both envs).
2. Set shipping-origin address in `.env` via `EBAY_LOCATION_*` (single shared setting across the whole app/both envs).
3. Log into the app → Settings → pick Sandbox/Production → "eBayでログイン" → approve on eBay's consent screen. The approved account becomes that env's connection and is set active immediately; `/api/ebay/callback` also auto-runs Business Policy/location setup.
4. Once Settings shows that env as connected, `/api/publish-ebay` works. If both envs are already connected, switching is just the "切り替える" button (no re-auth).

**Marketplace Account Deletion notification** (required for production compliance; webhook already implemented):
1. Set `EBAY_DELETION_VERIFICATION_TOKEN` (32–80 random alphanumeric chars, e.g. `openssl rand -hex 32`) and `EBAY_DELETION_ENDPOINT_URL` (`https://<backend-url>/api/ebay/deletion-notification`) on Render.
2. Register the same URL/token in Developer Portal → target keyset → Notifications → Marketplace Account Deletion (eBay immediately does a `challenge_code` handshake against `GET .../deletion-notification`).
3. From then on, a real deletion notice auto-disconnects via `deleteEbayConnectionsByUsername()`. Note: `ebay_username` is only populated for connections made *after* this feature shipped — earlier connections stay unmatched until reconnected.

## Deploy

- **Frontend**: Vercel (auto-detects Vite). Needs `VITE_BACKEND_URL` (Render URL; see [listingService.ts](src/services/listingService.ts), defaults to `localhost:3001`) and `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
- **Backend**: Render Web Service ([render.yaml](render.yaml) has the Blueprint). `sync: false` vars need manual entry in the dashboard (see [.env.example](.env.example)). `PORT` is auto-injected. No persistent disk — tokens etc. live in Supabase, not `.env`, so that's not an issue in practice.
- After deploying, update the RuName's "Your auth accepted URL" in eBay Developer Portal to the real Render URL.

## Env vars

`.env` is gitignored; see [.env.example](.env.example) for the full list. Get values from Google AI Studio / Groq Console / Supabase / eBay Developer.

| Category | Vars |
|---|---|
| Server | `PORT` / `ALLOWED_ORIGINS` (extra CORS origins, comma-separated; localhost:5173 + prod Vercel URL always allowed) |
| Supabase (backend) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase (frontend, build-time) | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| AI | `AI_PROVIDER` / `TEXT_AI_PROVIDER` (optional) / `GEMINI_API_KEY` / `GEMINI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` (vision) / `GROQ_TEXT_MODEL` (optional, text-only agents) |
| eBay auth | `EBAY_SANDBOX_CLIENT_ID`/`_SECRET`/`_RU_NAME`, `EBAY_PRODUCTION_CLIENT_ID`/`_SECRET`/`_RU_NAME` (Production optional), `EBAY_ENV`/`EBAY_USER_REFRESH_TOKEN` (local `setup:policies` only) |
| eBay listing config | `EBAY_MERCHANT_LOCATION_KEY` / `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID` (local-only fallbacks) / `EBAY_PAYMENT_POLICY_ID` |
| Shipping origin | `EBAY_LOCATION_ADDRESS_LINE1` / `_CITY` / `_STATE_OR_PROVINCE` / `_POSTAL_CODE` / `_COUNTRY` |
| eBay deletion webhook | `EBAY_DELETION_VERIFICATION_TOKEN` / `EBAY_DELETION_ENDPOINT_URL` |

## Spec deviations

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) assumed Python/FastAPI + OpenAI GPT-4o Vision; actual implementation is Node/Express + Gemini (`@google/genai`, Groq swappable). Endpoint names and snake_case response keys were kept aligned with the spec.

## Known limitations

- Market-trend analysis is based only on eBay Browse API's *currently active* listings, not actual sales (Marketplace Insights API needs individual approval, unused).
- Overall score is a snapshot from analysis time; doesn't recompute live as price is adjusted.
- Shipping origin is one single app-wide setting (Business Policies themselves are per-user/per-eBay-account).
- **No sold-item tracking**: nothing marks a `listings` row `SOLD`, so `totalRevenue`/`monthlyRevenue`/`soldItemsCount` stay 0 and the monthly-change badge stays hidden. Would need an eBay sale-notification webhook.
- **Images**: failed upload or mock mode (`useMockAnalysis` dev toggle) falls back to a `blob:` URL client-side; `/api/publish-ebay` swaps any non-http(s) URL for a placeholder (`https://placehold.co/500x500.png`).
- `categoryId` is a hardcoded placeholder (`112529`); real use needs Taxonomy API-based category detection.
- **AI quota**: up to 4 AI calls per photo set (extraction, condition, market-trend, competitor) — hits free-tier limits fast. `TEXT_AI_PROVIDER=groq` halves Gemini's share; see `aiProvider.js`. To escape Gemini entirely for vision too, `AI_PROVIDER=groq` (default vision model `qwen/qwen3.6-27b`, [groqClient.js](server/groqClient.js)'s `GROQ_MODEL` — the old default `meta-llama/llama-4-scout-17b-16e-instruct` was retired by Groq and now 404s; Groq's lineup changes often, re-verify via `groq.models.list()` before relying on a specific name). `qwen/qwen3.6-27b` is a reasoning model that emits a `<think>...</think>` block; `groqClient.js` passes `reasoning_format: 'hidden'` (only for models matching `REASONING_MODEL_PATTERN = /qwen|deepseek-r1|gpt-oss/i` — this param 400s on non-reasoning models, confirmed live) so Groq strips it server-side instead of returning it in `content`, plus `max_completion_tokens: 4096` since this account's tier has an 8000 TPM (tokens/minute) cap and an unconstrained reasoning generation for a vision prompt routinely exceeded it (one request with `max_completion_tokens: 8192` alone was rejected with a 413 for requesting 10651 tokens against the 8000 limit). **Caveat**: 8000 TPM is tight — one small image already used ~2459 prompt tokens — so this model may not reliably handle the app's real multi-photo (up to 8 images) analyze-image flow; treat it as an occasional single/few-photo Gemini-rate-limit escape hatch, not a primary vision provider, unless the Groq account is upgraded off the free on-demand tier. Text-only agents (market-trend/competitor) use a separate `GROQ_TEXT_MODEL` (default `llama-3.3-70b-versatile`, non-reasoning) instead of reusing `GROQ_MODEL` — routing them through a reasoning model too made `/api/estimate-price` noticeably slower for no benefit (confirmed: switching cut a live 2-call parallel test from several seconds to ~1s) since those tasks don't need vision.
- **Price search returning $0 with real inventory available**: the AI-generated title used as the Browse API `q` search keyword can end up too specific/off (e.g. AI misreads brand/model as generic "Unbranded"-style text), returning 0 hits even when the actual product has plenty of real listings. `/api/estimate-price` now retries with progressively simpler queries — full title → `brand + model` (from `productDraft.aspects`) → first 4 words of the title — stopping at the first query that returns results, and logs which query actually hit (or that all three returned 0) so this is diagnosable from server logs going forward.
- Sandbox listing tests and Application Growth Check (AGC, raises prod call limits) haven't been done — both require the user's own action in Developer Portal.

## Security

- **CORS**: only `ALLOWED_ORIGINS` + localhost:5173 + prod Vercel URL pattern.
- **XSS**: any user-controlled value interpolated into an HTML response goes through `escapeHtml()`.
- **OAuth CSRF**: `state` is a one-time, 10-min-TTL random nonce (`oauthStateStore.js`), never a raw userId — knowing someone's Supabase user ID alone can't link your eBay account to their app account.
- **Deletion-notification authenticity**: `POST /api/ebay/deletion-notification` verifies `x-ebay-signature` (`ebayNotificationVerifier.js`) before acting, so a forged request can't sever someone else's eBay connection.
- **Upload limits**: 10MB cap, `image/*` only (multer).
- **Auth/data isolation**: every API verifies the Supabase token via `requireAuth` → `req.userId`; all DB access is scoped by `user_id` (`ebay_connections` by `user_id, environment`). RLS is on, but the backend's `service_role` always bypasses it — actual access control lives in this application-layer scoping.
- **Secrets**: `.env` is gitignored; service_role/client-secret values never reach the frontend.
