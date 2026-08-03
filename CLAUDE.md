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
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | `getListings()` for sales summary + recent listings (refetched on mount and after publish). Shows skeleton while `isLoading` instead of flashing zero values. Recent-listings list is capped at `max-h-[45vh] overflow-y-auto` so it scrolls internally instead of growing the page as listings accumulate (see App.tsx layout note below). "すべて見る" opens [AllListingsScreen.tsx](src/components/AllListingsScreen.tsx). |
| [AllListingsScreen.tsx](src/components/AllListingsScreen.tsx) | Full-screen, back-navigable search over *all* of the user's listings (`searchListings(query)` → `GET /api/listings/search?q=`, 300ms debounced). Matches keyword against title or category (case-insensitive substring, filtered server-side in JS — not a raw PostgREST `.or()` filter, to avoid filter-string injection from user input). Tapping a result opens `ListingDetailModal` same as from Home. |
| [ResearchPanel.tsx](src/components/ResearchPanel.tsx) | Research tab. A "category" is just a labeled search query (`ResearchCategoryDef = {key, label, query, isCustom}`) — 3 built-in ones (コスメ/ゲーム/ガジェット, `isCustom: false`, not deletable) plus any the user has saved from a free-text search (`isCustom: true`, `×` button to remove, persisted in `localStorage` under `ebay-ai-lister-research-custom-categories` so adding a new category is just typing a keyword once and tapping "＋カテゴリに追加" — no code change needed). Category selection and the free-text search box are mutually exclusive; both call the same `searchResearchArticles(query)` → `GET /api/research/articles?q=`. Article cards (title/source) are each an `<a target="_blank">` straight to the real article URL. No AI call involved (see below) — keyword search against NewsData.io, so no Gemini/Groq quota concerns. Nothing auto-refreshes while the tab stays open — each mount/category-click/search-submit does a fresh live fetch. |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | `getAnalytics()` → monthly trend + category breakdown charts. |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | `getEbayStatus()` shows Sandbox/Production connection state + active env. Tab picks which env; shows "eBayでログイン" (`getEbayAuthUrl(env)`) if disconnected, "切り替える" (`setActiveEbayEnv(env)`, behind a confirm dialog) if connected-but-inactive. Also mock-analysis toggle, logout. |
| Step1_ImageUpload → Step4_Preview | Wizard: photograph → review/edit AI result → price → confirm. Up to `MAX_PHOTOS`=8 photos. **Step1 does not auto-analyze on file pick** — shows thumbnails with per-photo remove (×) and an "追加" (add more) tile first; analysis only starts when the user taps "この写真で解析する" (`onConfirm(files)`). Step2's "追加" button appends to the original file set (`App.tsx`'s `selectedFiles`) and re-runs `runAnalysis()` over *all* photos so AI can re-synthesize with the new angle. [StepperHeader.tsx](src/components/StepperHeader.tsx) handles step nav (Step2+ blocked until analysis exists). |
| [ListingDetailModal.tsx](src/components/ListingDetailModal.tsx) | Opens from a recent-listing tap (Home or AllListingsScreen); `getListingDetail(id)`. |
| [Toast.tsx](src/components/Toast.tsx) / [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx) | Success/error toast / cancel-listing confirm. |
| [BottomNav.tsx](src/components/BottomNav.tsx) | Home/Research/Analytics/Settings tabs. |

- **Auth**: [supabaseClient.ts](src/services/supabaseClient.ts) uses only the publishable/anon key. `App.tsx` watches `supabase.auth.getSession()`/`onAuthStateChange()`. All data access goes through the backend, never this client directly (`listingService.ts` attaches `Authorization: Bearer <access_token>` to every request).
- **Types**: [types/listing.ts](src/types/listing.ts) (`ProductData` — `imageUrls: string[]`, multi-photo — `Condition`, AI analysis results), [types/app.ts](src/types/app.ts) (`TabType`, `RecentListing`, `ListingDetail`, `SalesSummary`, `AnalyticsData`, `EbayEnvironment`, `EbayStatus`, `ResearchCategory`, `ResearchArticle`).
- **API client**: [listingService.ts](src/services/listingService.ts) — `analyzeImageWithAI(files: File[])`, `estimatePrice`, `publishToEbay`, `getListings`, `getAnalytics`, `getListingDetail`, `searchResearchArticles(query)`, `getEbayAuthUrl(env)`, `getEbayStatus`, `setActiveEbayEnv(env)`, all hitting the backend (default `http://localhost:3001/api`, override via `VITE_BACKEND_URL`). `mockAnalyzeImage`/`mockPublishItem` ([mock/mockData.ts](src/mock/mockData.ts)) back the dev mock toggle.

### Backend

[server/index.js](server/index.js) (Express, `npm run server`, needs `.env`). Every route except `/api/ebay/callback` and `/api/ebay/deletion-notification` goes through [authMiddleware.js](server/authMiddleware.js)'s `requireAuth` (verifies the Supabase access token → `req.userId`, else 401). CORS is restricted to `ALLOWED_ORIGINS` + `localhost:5173` + a regex covering `https://a-ie-bay-app*.vercel.app` (production/branch/preview Vercel URLs). Image upload capped at 10MB, `image/*` only (multer). Any user input echoed into an HTML response is passed through `escapeHtml()`.

| Method / Path | Notes |
|---|---|
| `POST /api/analyze-image` | Accepts 1–8 images (`multipart/form-data`, field `images`). Sends all images in one call to Gemini/Groq for a single combined title/brand/model/condition/description/aspects JSON. Runs `runConditionAgent` (also multi-image) and `uploadProductImage` (all files) via `Promise.all`; returns `imageUrls[]`. |
| `POST /api/estimate-price` | Primary path: `runMarketResearchAgent` (Gemini + Google Search grounding, `geminiClient.js`'s `generateGroundedJson`) researches real-world market price across the whole internet (not just eBay) in one call, factoring in `conditionAssessment`, and returns price range + market trend + competitor suggestions together. Replaces the old eBay-Browse-API-only search, which returned $0 whenever the AI-generated title didn't keyword-match eBay's inventory exactly (e.g. AI misread brand/model as generic "Unbranded"-style text) — general web search is far more forgiving. **Fallback**: if the grounded call throws (network/quota) or returns `suggested_price: 0`, falls back to the old path — PRODUCTION Browse API search (Sandbox has almost no real inventory) with a 3-tier query fallback (full title → `brand + model` → first 4 words) → IQR outlier removal → `runMarketTrendAgent`/`runCompetitorAgent`. This fallback's price stats have no Gemini dependency, so a price is still returned even during total Gemini quota exhaustion (confirmed live: grounded call 429'd, fallback still returned a real $27–$200 range instead of $0). Deterministic `scoreListing` always runs regardless of which path supplied the price. |
| `POST /api/publish-ebay` | Uses `ebay_connections`' Business Policy IDs + location via Sell Inventory API (Item→Offer→Publish). `productData.imageUrls` passed straight through as eBay's `product.imageUrls` (non-http(s) entries dropped; placeholder image if none valid). Fills required Item Specifics (Brand/Color/Connectivity/Model/Type, fixed `categoryId=112529`) with defaults. **Condition** is resolved via `CONDITION_INFO` (app's 4-tier NEW/USED_EXCELLENT/USED_GOOD/USED_FAIR → real eBay `ConditionEnum`+numeric id; `USED_FAIR` isn't a real eBay enum, mapped to `USED_ACCEPTABLE`), then checked against that category's actual allowed conditions via Sell Metadata API `get_item_condition_policies` and swapped to the closest allowed candidate if unsupported (category `112529` only allows NEW/NEW_OTHER/USED_EXCELLENT/FOR_PARTS_OR_NOT_WORKING in production — `USED_GOOD` used to get rejected with errorId 25021). Saves history via `saveListing()` (own history table stores one cover image, `imageUrls[0]`). |
| `GET /api/listings` | Own recent listings (capped, `getRecentListings`) + sales summary. |
| `GET /api/listings/search` | `?q=`. All of the user's listings (`getAllListings`, capped at 500), filtered in JS by title/category substring match — must stay registered *before* `/api/listings/:id` or Express would match `search` as `:id`. Backs the Home "すべて見る" screen. |
| `GET /api/listings/:id` | Full row incl. description/aspects. |
| `GET /api/analytics` | Monthly trend (6mo) + category breakdown. |
| `GET /api/research/articles` | `?q=<any keyword>`. Backs the Research tab — a "find what's trending/exportable" discovery feed, first step toward the requested export-arbitrage tool (e.g. Japan-cheap/overseas-pricey items like Nivea lip balm or Fino hair masks). No category concept server-side at all — every request, whether from a built-in category button or free-text search, is just a keyword passed straight to `searchResearchArticles` ([researchFeeds.js](server/researchFeeds.js)), which queries NewsData.io's `/api/1/latest`. **No AI call** — deliberately kept AI-free so it never burns Gemini/Groq quota. Returns latest articles (title/link/source/pubDate), capped at 30. Requires `NEWSDATA_API_KEY` — throws a clear Japanese "not configured" error (surfaced to the UI) if missing, rather than crashing. |
| `GET /api/ebay/auth-url` | `?env=SANDBOX\|PRODUCTION` (default SANDBOX). `state` = a one-time nonce from `createOAuthState()`, not a raw userId. |
| `GET /api/ebay/callback` | Public. `consumeOAuthState(state)` burns the nonce once to recover userId/env, then `exchangeAuthCodeForTokens`→`getEbayUsername`→`setEbayConnection`→`setActiveEbayEnv`→`setupEbayPoliciesForToken()`. `error` query param is HTML-escaped (was a reflected-XSS hole). |
| `GET /api/ebay/status` | Both envs' connection state (+ `ebayUsername`) and `activeEnv`. |
| `POST /api/ebay/active-env` | Instant switch to an already-connected env (`{ environment }`, 400 if not connected). No restart needed. |
| `GET,POST /api/ebay/deletion-notification` | Public. GET = challenge_code handshake. POST verifies `x-ebay-signature` via `verifyEbayNotificationSignature()` before deleting the matching `ebay_connections` row (bad signature → 412; infra failure while verifying → fail-open + log, so a real deletion notice is never silently dropped). `deleteEbayConnectionsByUsername()` returns the actual deleted row count so the log accurately says "no connection found" vs "disconnected" (a notified username with zero matching rows — e.g. eBay's own test notifications — is not an app bug or a data leak from unrelated users). |

#### Backend modules

| File | Role |
|---|---|
| [authMiddleware.js](server/authMiddleware.js) | `requireAuth` — verifies Supabase token → `req.userId`. |
| [aiProvider.js](server/aiProvider.js) | `AI_PROVIDER` (`gemini`/`groq`) picks the vision engine; `TEXT_AI_PROVIDER` (defaults to `AI_PROVIDER`) independently picks the engine for text-only agents. Exports `generateImageJson(promptText, images)` (vision) and `generateJson()` (text). `images` = `[{base64Image, mimeType}, ...]`. Both currently default to `gemini` — the Groq path (`TEXT_AI_PROVIDER=groq`) was tried as a quota-saving measure but reverted back to all-Gemini per user request; the code is still there and working if needed again. Note: Google Search grounding (`runMarketResearchAgent`) is Gemini-only and calls `geminiClient.js` directly, bypassing this abstraction entirely, since Groq has no grounding tool. |
| [analysisAgents.js](server/analysisAgents.js) | `runConditionAgent(images)`; `runMarketResearchAgent({title, brand, model, condition, conditionAssessment})` (primary price-research path, Gemini+Search grounding, see `/api/estimate-price`); `runMarketTrendAgent`/`runCompetitorAgent` (Browse-API-item-based, now only used as the fallback path, always run even with 0 comparable items); `scoreListing` (deterministic, no LLM). |
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
| [researchFeeds.js](server/researchFeeds.js) | `searchResearchArticles(query)` — single function backing the entire Research tab (both built-in categories and free-text search funnel through this). Calls NewsData.io's `/api/1/latest` (`language=ja`, `country=jp`, `q=<query, truncated to 100 chars>`). **Why NewsData.io specifically**: checked live — GNews/Mediastack free tiers explicitly forbid commercial use (Essential/Basic paid tiers required, ~€25–50/mo), and the earlier Google News search-RSS approach is scoped by Google's own feed metadata to personal/non-commercial use; NewsData.io's free tier is the one that explicitly permits commercial use (200 credits/day, 12h article delay, 30 credits/15min rate limit, no Gemini/Groq quota impact since it's a plain news API). Throws a clear Japanese error (surfaced to the UI, not a crash) if `NEWSDATA_API_KEY` is unset. |

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
| Research tab | `NEWSDATA_API_KEY` (get one at https://newsdata.io/register — free, commercially-licensed, no card required) |

## Spec deviations

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) assumed Python/FastAPI + OpenAI GPT-4o Vision; actual implementation is Node/Express + Gemini (`@google/genai`, Groq swappable). Endpoint names and snake_case response keys were kept aligned with the spec.

## Known limitations

- Market-trend analysis is based only on eBay Browse API's *currently active* listings, not actual sales (Marketplace Insights API needs individual approval, unused).
- Overall score is a snapshot from analysis time; doesn't recompute live as price is adjusted.
- Shipping origin is one single app-wide setting (Business Policies themselves are per-user/per-eBay-account).
- **No sold-item tracking**: nothing marks a `listings` row `SOLD`, so `totalRevenue`/`monthlyRevenue`/`soldItemsCount` stay 0 and the monthly-change badge stays hidden. Would need an eBay sale-notification webhook.
- **Images**: failed upload or mock mode (`useMockAnalysis` dev toggle) falls back to a `blob:` URL client-side; `/api/publish-ebay` swaps any non-http(s) URL for a placeholder (`https://placehold.co/500x500.png`).
- `categoryId` is a hardcoded placeholder (`112529`); real use needs Taxonomy API-based category detection.
- **AI quota**: up to 4 Gemini calls per photo set (extraction, condition, price research, and the Browse-API fallback's market-trend/competitor calls only when that fallback triggers) — hits free-tier limits fast (confirmed live: this account's Gemini quota was fully exhausted (`RESOURCE_EXHAUSTED`, 429) mid-session, on both grounded and plain calls). GitHub Models was considered as a second free provider but is a dead end — fully retired July 30, 2026 (confirmed live via GitHub's own changelog), no BYOK/API access at all anymore. Groq (`AI_PROVIDER=groq`/`TEXT_AI_PROVIDER=groq`) is the working escape hatch, fully wired up ([groqClient.js](server/groqClient.js): vision defaults to `qwen/qwen3.6-27b` since the old default `meta-llama/llama-4-scout-17b-16e-instruct` was retired by Groq and 404s now; text-only agents use a separate `GROQ_TEXT_MODEL`, default `llama-3.3-70b-versatile`, non-reasoning — routing text through the reasoning `qwen` model made `/api/estimate-price` noticeably slower for no benefit; `reasoning_format: 'hidden'` is applied only to models matching `REASONING_MODEL_PATTERN = /qwen|deepseek-r1|gpt-oss/i` since that param 400s on non-reasoning models; this account's `qwen/qwen3.6-27b` tier also has a tight 8000 TPM cap). When `TEXT_AI_PROVIDER=groq`, `/api/estimate-price` skips the Gemini-only `runMarketResearchAgent` grounded-search call entirely (it would just 429) and goes straight to the eBay Browse API fallback + Groq-routed market-trend/competitor agents — see [index.js](server/index.js)'s `TEXT_AI_PROVIDER !== 'groq'` guard. Default/steady-state is Gemini-only (`AI_PROVIDER=gemini`, `TEXT_AI_PROVIDER=gemini`) per user preference; flip both to `groq` (as done live during a same-day Gemini outage, confirmed working end-to-end: vision ~1s, text agents ~0.9s) whenever Gemini quota is the active blocker, then flip back once it recovers.
- **Price search returning $0 with real inventory available**: previously, the AI-generated title used as the Browse API `q` search keyword could end up too specific/off (e.g. AI misreads brand/model as generic "Unbranded"-style text), returning 0 hits even when the actual product had plenty of real listings. Fixed by making `/api/estimate-price`'s primary price source `runMarketResearchAgent` (Gemini Google-Search grounding, searches the whole internet, not just eBay's exact-keyword inventory) — see the `/api/estimate-price` row above. The old eBay Browse API path (with its own 3-tier query fallback: full title → `brand + model` → first 4 words, logs which query hit) is kept as a secondary fallback for when Gemini itself is unavailable, so a real price is still returned even during a full Gemini outage.
- Sandbox listing tests and Application Growth Check (AGC, raises prod call limits) haven't been done — both require the user's own action in Developer Portal.
- **Mobile layout: BottomNav creeping down as listings grow** — [App.tsx](src/App.tsx)'s phone-frame wrapper used to be `min-h-screen min-h-dvh` (grows with content) with `BottomNav`'s `absolute bottom-0` positioned relative to it, so as `HomeDashboard`'s recent-listings list grew, the whole frame grew taller and pushed the nav down with it (confirmed live: with 25 seeded listings, `body.scrollHeight` exceeded `window.innerHeight` and the nav's bounding box moved well past the viewport). Fixed by making the frame `h-screen h-dvh overflow-hidden` (fixed to viewport, doesn't grow) and moving scrolling to the inner `main`/wizard containers (`flex-1 overflow-y-auto`); `HomeDashboard`'s recent-listings list is additionally capped at `max-h-[45vh] overflow-y-auto` so it scrolls internally rather than growing the tab. Re-verified live with 25 seeded listings: `body.scrollHeight === window.innerHeight` and the nav's bounding box stays pinned to the bottom of the viewport regardless of list length.
- **Mobile: app screen appears zoomed in right after login** — most likely mobile Safari/Chrome failing to reset pinch/focus-zoom when the focused password `<input>` is unmounted (AuthScreen swapped out for the main app) without ever receiving a normal blur. Fixed by explicitly `(document.activeElement as HTMLElement | null)?.blur()` at the top of [AuthScreen.tsx](src/components/AuthScreen.tsx)'s `handleSubmit`, before the async sign-in call, so the keyboard/zoom closes before the DOM swap rather than during it.

## Security

- **CORS**: only `ALLOWED_ORIGINS` + localhost:5173 + prod Vercel URL pattern.
- **XSS**: any user-controlled value interpolated into an HTML response goes through `escapeHtml()`.
- **OAuth CSRF**: `state` is a one-time, 10-min-TTL random nonce (`oauthStateStore.js`), never a raw userId — knowing someone's Supabase user ID alone can't link your eBay account to their app account.
- **Deletion-notification authenticity**: `POST /api/ebay/deletion-notification` verifies `x-ebay-signature` (`ebayNotificationVerifier.js`) before acting, so a forged request can't sever someone else's eBay connection.
- **Upload limits**: 10MB cap, `image/*` only (multer).
- **Auth/data isolation**: every API verifies the Supabase token via `requireAuth` → `req.userId`; all DB access is scoped by `user_id` (`ebay_connections` by `user_id, environment`). RLS is on, but the backend's `service_role` always bypasses it — actual access control lives in this application-layer scoping.
- **Secrets**: `.env` is gitignored; service_role/client-secret values never reach the frontend.
