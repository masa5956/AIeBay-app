# CLAUDE.md

Guidance for Claude Code when working in this repo. Written in English for token efficiency; you must still always reply to the user in Japanese (see below).

## Language rule
常に日本語で会話・コメント・エラー説明・ドキュメントを記述する。(Always respond, comment, and write docs in Japanese — this rule itself stays in Japanese since it defines that policy; the rest of this file is English purely to save tokens.)

## Overview

eBay AI auto-listing tool. Phone-style React SPA: user photographs a product, Gemini/Groq (vision) extracts listing data, multiple AI agents (market trend, competitor comparison, condition) analyze it, then a wizard publishes to eBay. **Multi-user**: own Supabase Auth (email+password); listings, sales, and connected eBay accounts are isolated per user. Full spec: [PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) (implementation differs — see bottom).

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

Vite + React18 + TS + Tailwind + `lucide-react` + `recharts`. [App.tsx](src/App.tsx) is a thin shell; screens live in [src/components/](src/components/). `AnalyticsPanel`/`ListingDetailModal` are `React.lazy`-loaded (recharts is ~100KB gzip).

| Component | Notes |
|---|---|
| [AuthScreen.tsx](src/components/AuthScreen.tsx) | Login/signup (Supabase Auth). Shown alone when logged out. |
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | `getListings()` for sales summary + recent listings. Skeleton while loading. List capped at `max-h-[45vh] overflow-y-auto` (scrolls internally, see App.tsx layout note in Known limitations). "すべて見る" → [AllListingsScreen.tsx](src/components/AllListingsScreen.tsx). |
| [AllListingsScreen.tsx](src/components/AllListingsScreen.tsx) | Search over all of the user's listings (`searchListings(query)` → `GET /api/listings/search?q=`, 300ms debounced). Title/category substring match, filtered server-side in JS — not a raw PostgREST `.or()` filter (avoids filter-string injection). |
| [ResearchPanel.tsx](src/components/ResearchPanel.tsx) | A "category" is just a labeled search query (`ResearchCategoryDef = {key, label, query, isCustom}`) — 3 built-ins (コスメ/ゲーム/ガジェット, not deletable, deliberately single plain words: see [researchFeeds.js](server/researchFeeds.js) note on `OR`) plus user-saved custom ones (localStorage key `ebay-ai-lister-research-custom-categories`). Both paths call `searchResearchArticles(query)` → `GET /api/research/articles?q=`. No AI call — keyword search against Serper.dev only. |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | `getAnalytics()` → monthly trend + category breakdown charts. |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | `getEbayStatus()` for Sandbox/Production state + active env; "eBayでログイン" / "切り替える" (confirm dialog). **Shipping address**: masked by default (`getShippingAddressStatus()` → `{hasAddress, maskedPreview}`, no plaintext); "表示/編集する" opens [ReauthPasswordModal.tsx](src/components/ReauthPasswordModal.tsx), which calls `revealShippingAddress(password)` (server-side password re-verification, see Security) before showing the editable form. Also mock-analysis toggle, logout. |
| Step1_ImageUpload → Step4_Preview | Wizard: photograph → review/edit AI result (incl. eBay category picker + Item Specifics add/remove UI) → price/selling-method/quantity → confirm. Up to `MAX_PHOTOS`=8. Step1 requires an explicit "この写真で解析する" tap before analysis starts (no auto-analyze on file pick). Step2's "追加" appends photos and re-runs analysis over all of them; its own "+ 仕様を追加" adds a custom Item Specific key/value pair, and a category picker (from AI-title-derived `getCategorySuggestions`) fetches `getCategoryAspects` to badge/require category-specific fields. Step3 adds a 固定価格/オークション segmented control (duration/starting bid/reserve price when auction) and a quantity input. Step4 shows category/condition/aspects and blocks publish while required aspects are empty. [StepperHeader.tsx](src/components/StepperHeader.tsx) blocks Step2+ until analysis exists. |
| [ListingDetailModal.tsx](src/components/ListingDetailModal.tsx) | Opens from a recent-listing tap; `getListingDetail(id)`. When `status==='ACTIVE' && canManage` (i.e. `offer_id` was captured at publish time): in-place quantity editor (`updateListingQuantity`), "売却済みにする" (`markListingSold`, local status only), "出品をキャンセルする" (`cancelListing`, calls eBay `withdrawOffer`) — both behind [ConfirmDialog.tsx](src/components/ConfirmDialog.tsx). |
| [Toast.tsx](src/components/Toast.tsx) / [ConfirmDialog.tsx](src/components/ConfirmDialog.tsx) | Success/error toast / generic confirm dialog (props-driven title/body/confirmLabel) — reused for wizard-abandon, listing-cancel, and mark-sold confirmations (this codebase's "キャンセル" has more than one meaning; one component, different copy). |
| [BottomNav.tsx](src/components/BottomNav.tsx) | Home/Research/Analytics/Settings tabs. |

- **Auth**: [supabaseClient.ts](src/services/supabaseClient.ts) uses only the publishable/anon key. All data access goes through the backend (`listingService.ts` attaches `Authorization: Bearer <access_token>`), never Supabase directly.
- **Types**: [types/listing.ts](src/types/listing.ts) (`ProductData`, `Condition`, `ProductAspect` w/ `required?`, `CategorySuggestion`, `CategoryAspectDef`, `ListingFormat`/`AuctionSettings`, AI analysis results), [types/app.ts](src/types/app.ts) (`TabType`, `RecentListing`, `ListingDetail` w/ `quantity`/`format`/`canManage`, `SalesSummary`, `AnalyticsData`, `EbayEnvironment`, `EbayStatus`, `ShippingAddress`, `ShippingAddressStatus`, `ResearchCategory`, `ResearchArticle`).
- **API client**: [listingService.ts](src/services/listingService.ts) — `analyzeImageWithAI`, `estimatePrice`, `publishToEbay`, `getListings`, `getAnalytics`, `getListingDetail`, `searchResearchArticles`, `getEbayAuthUrl`, `getEbayStatus`, `setActiveEbayEnv`, `getShippingAddressStatus`/`revealShippingAddress`/`saveShippingAddress`/`deleteShippingAddress`, `getCategorySuggestions`/`getCategoryAspects`, `cancelListing`/`markListingSold`/`updateListingQuantity`, all hitting the backend (default `http://localhost:3001/api`, override via `VITE_BACKEND_URL`). `mockAnalyzeImage`/`mockPublishItem` back the dev mock toggle.

### Backend

[server/index.js](server/index.js) (Express, `npm run server`, needs `.env`). Every route except `/api/ebay/callback` and `/api/ebay/deletion-notification` goes through [authMiddleware.js](server/authMiddleware.js)'s `requireAuth` (→ `req.userId`, else 401). CORS: `ALLOWED_ORIGINS` + `localhost:5173` + a regex for `https://a-ie-bay-app*.vercel.app`. `helmet()` (CSP disabled — `/api/ebay/callback` returns inline-script HTML) sets security headers; `express-rate-limit` applies a general 100/min/IP limiter to all of `/api/*`, a stricter 10/min/IP limiter to `/api/analyze-image`/`/api/publish-ebay`/`/api/ebay/auth-url`, and a 5/15min limiter to the address-reveal endpoint. `express.json({ limit: '256kb' })`. Image upload capped at 10MB, `image/*` only (multer). User input echoed into HTML goes through `escapeHtml()`.

| Method / Path | Notes |
|---|---|
| `POST /api/analyze-image` | 1–8 images → one combined title/brand/model/condition/description/aspects JSON via Gemini/Groq. Runs `runConditionAgent` + `uploadProductImage` via `Promise.all`; returns `imageUrls[]`. |
| `POST /api/estimate-price` | Primary: `runMarketResearchAgent` (Gemini + Google Search grounding) researches real-world price across the whole internet, returns price range + market trend + competitor suggestions together. **Fallback** (grounded call throws or returns `suggested_price: 0`): PRODUCTION Browse API search, 3-tier query fallback (full title → `brand + model` → first 4 words) → IQR outlier removal → `runMarketTrendAgent`/`runCompetitorAgent`. Deterministic `scoreListing` always runs regardless of path. |
| `GET /api/ebay/category-suggestions` | `?q=<keywords>`. Thin wrapper over [ebayTaxonomy.js](server/ebayTaxonomy.js)'s `getCategorySuggestions` (eBay Taxonomy API `get_category_suggestions`). Frontend never auto-applies the top match — user must pick one in Step2. |
| `GET /api/ebay/category-aspects` | `?categoryId=<id>`. Wrapper over `getItemAspectsForCategory` (Taxonomy API `get_item_aspects_for_category`) → `{name, required, mode, cardinality, allowedValues}[]`, used to badge/require Step2's Item Specifics. |
| `POST /api/publish-ebay` | Sell Inventory API (Item→Offer→Publish) using `ebay_connections`' Business Policy IDs + location. Non-http(s) `imageUrls` dropped (placeholder if none valid). `categoryId` falls back to `112529` only if the frontend never sent a Taxonomy-selected one. **Required Item Specifics**: `getItemAspectsForCategory(environment, categoryId)` result is diffed against `productData.aspects` — missing *required* aspects → 400 (fail-open only on the Taxonomy *call itself* throwing, mirroring the Condition check below; no more blind `REQUIRED_ASPECT_DEFAULTS` placeholder-filling). **Selling format**: `productData.pricing.format` — `FIXED_PRICE` (`pricingSummary.price`) or `AUCTION` (`validateAuctionSettings()` checks duration ∈ `DAYS_{1,3,5,7,10}`/`startingBid>0`/`reservePrice>=startingBid` before any eBay call; sends `pricingSummary.auctionStartPrice`/`auctionReservePrice` + `listingDuration`) — both go through `createOffer`'s native `format` field, no Trading API needed. **Quantity**: `productData.quantity` (0–9999, default 1) → both the Inventory Item's `availability` and the Offer's `availableQuantity` (previously hardcoded to `1`). **Condition** resolved via `CONDITION_INFO` (4-tier → real eBay enum; `USED_FAIR`→`USED_ACCEPTABLE`), checked against the category's allowed conditions via Sell Metadata API and swapped if unsupported. Saves history via `saveListing()`, now including `offerId`/`quantity`/`format` (needed by the cancel/quantity routes below). |
| `POST /api/listings/:id/cancel` | Ends a live listing via `withdrawOffer` (`POST /offer/{offerId}/withdraw`) — keeps the Offer object relistable, matches Seller Hub's "End listing", unlike `deleteOffer` which isn't usable on a published offer. 404/ownership via `getListingByListingId(userId, id)`; 400 if not `ACTIVE` or `offer_id` is null (pre-migration rows — must be ended from Seller Hub directly). Sets local `status='CANCELLED'` via `updateListingStatus()`. |
| `POST /api/listings/:id/mark-sold` | Manual-only: does **not** call eBay (no sale-notification webhook exists — see Known limitations), just flips local `status='SOLD'` so `getSalesSummary`'s `totalRevenue`/`soldItemsCount` become meaningful for listings the seller manually reconciles. |
| `PATCH /api/listings/:id/quantity` | Body `{quantity}` (0–9999). Calls `POST /sell/inventory/v1/bulk_update_price_quantity` (updates InventoryItem + Offer atomically in one call — the eBay-recommended way to adjust a *live* listing's stock, vs. separately re-`PUT`ting inventory_item/offer) then `updateListingQuantity()`. 400 if not `ACTIVE` or `offer_id` is null. |
| `GET /api/listings` | Recent listings + sales summary. |
| `GET /api/listings/search` | `?q=`, JS substring match over all listings (capped 500). Must be registered *before* `/api/listings/:id`. |
| `GET /api/listings/:id` | Full row incl. description/aspects/`quantity`/`format`/`canManage` (`canManage = !!offer_id`, gates the cancel/quantity UI for listings published before this feature). |
| `GET /api/analytics` | Monthly trend (6mo) + category breakdown. |
| `GET /api/research/articles` | `?q=<keyword>`. Keyword passed straight to `searchResearchArticles` ([researchFeeds.js](server/researchFeeds.js)), Serper.dev `POST /news`. No AI call. Capped at 30 results. Requires `SERPER_API_KEY`. |
| `GET /api/ebay/auth-url` | `?env=SANDBOX\|PRODUCTION`. `state` = one-time nonce (`createOAuthState()`). 400 if the user hasn't saved a shipping address yet. |
| `GET /api/ebay/callback` | Public. `consumeOAuthState(state)` → `exchangeAuthCodeForTokens`→`getEbayUsername`→`setEbayConnection`→`setActiveEbayEnv`→`setupEbayPoliciesForToken(token, env, address)` (address = that user's own decrypted `getShippingAddress`). `error` param HTML-escaped. |
| `GET /api/ebay/status` | Both envs' connection state + `activeEnv`. |
| `POST /api/ebay/active-env` | Switch to an already-connected env (400 if not connected). |
| `GET /api/settings/shipping-address` | Returns `{hasAddress, maskedPreview}` **only** — never plaintext (see Security). Plaintext requires `POST .../reveal`. |
| `POST /api/settings/shipping-address/reveal` | Body `{password}`. Rate-limited (5/15min). Looks up the user's email via `supabase.auth.admin.getUserById`, verifies the password via a throwaway `supabaseAnon.auth.signInWithPassword` call (session discarded, never persisted), then returns the decrypted address only on success. |
| `PUT,DELETE /api/settings/shipping-address` | `PUT` validates: `addressLine1` 1–200 chars, `city` 1–100, `stateOrProvince` ≤100 (optional), `postalCode` 1–20, `country` must match `^[A-Z]{2}$`. `DELETE` clears it (no reveal required — clearing isn't a read). Must be saved before `/api/ebay/auth-url` succeeds. |
| `GET,POST /api/ebay/deletion-notification` | Public. GET = challenge_code handshake. POST verifies `x-ebay-signature` before deleting the matching `ebay_connections` row (bad signature → 412; verify failure → fail-open + log). `deleteEbayConnectionsByUsername()` returns deleted-row count for accurate logging. |

#### Backend modules

| File | Role |
|---|---|
| [authMiddleware.js](server/authMiddleware.js) | `requireAuth` — verifies Supabase token → `req.userId`. |
| [aiProvider.js](server/aiProvider.js) | `AI_PROVIDER` picks the vision engine; `TEXT_AI_PROVIDER` (defaults to `AI_PROVIDER`) picks the text-agent engine independently. Both default `gemini`; Groq path fully wired but off by default per user preference. Google Search grounding (`runMarketResearchAgent`) is Gemini-only, calls `geminiClient.js` directly (bypasses this abstraction) since Groq has no grounding tool. |
| [analysisAgents.js](server/analysisAgents.js) | `runConditionAgent`; `runMarketResearchAgent` (primary price path); `runMarketTrendAgent`/`runCompetitorAgent` (Browse-API fallback path); `scoreListing` (deterministic, no LLM). |
| [priceStats.js](server/priceStats.js) | `removeOutliersByIQR()`. |
| [ebayAuth.js](server/ebayAuth.js) | `getEbayEnvConfig(environment)` resolves baseUrl/authUrl/credentials per env. Token functions cached via [ebayTokenCache.js](server/ebayTokenCache.js). `USER_SCOPES` (refresh grants) vs `AUTH_SCOPES` (consent screen only, adds `commerce.identity.readonly`) are deliberately separate — merging breaks existing connections' token refresh. **This is why Promoted Listings (`sell.marketing` scope) is deliberately out of scope for now** — it needs to be in `USER_SCOPES` (every publish/cancel/quantity call uses the refreshed token), and eBay's refresh grant rejects a scope not in the original consent, so adding it would break every already-connected account's next token refresh until they redo "eBayでログイン". Revisit only as its own explicit migration. |
| [ebayTaxonomy.js](server/ebayTaxonomy.js) | `getDefaultCategoryTreeId`/`getCategorySuggestions`/`getItemAspectsForCategory` — eBay Taxonomy API (`commerce/taxonomy/v1`), app-token auth. In-memory 6h TTL cache per environment/query/categoryId (category schemas change rarely). Deliberately used instead of hand-cataloging eBay's category tree from a 3rd-party site — always current, covers every category/subcategory, and mirrors the existing Condition-policy-check shape (call eBay metadata → reconcile → fail-open on error). |
| [ebayConnectionsRepository.js](server/ebayConnectionsRepository.js) | `ebay_connections` CRUD, keyed by `userId, environment`. |
| [userSettingsRepository.js](server/userSettingsRepository.js) | `user_settings` — `getActiveEbayEnv`/`setActiveEbayEnv`; `getShippingAddress`/`setShippingAddress`/`clearShippingAddress` (single encrypted blob via [addressCrypto.js](server/addressCrypto.js)). `getShippingAddress` returns `null` on unset *or* decryption failure, never throws/leaks internals. |
| [addressCrypto.js](server/addressCrypto.js) | `encryptAddress`/`decryptAddress` — AES-256-GCM, key from `SHIPPING_ADDRESS_ENCRYPTION_KEY` (32-byte base64). Fail-closed (throws if key missing/wrong length, no plaintext fallback). Whole address JSON-serialized and encrypted as one blob, not per-field. |
| [setupPolicies.js](server/setupPolicies.js) | `setupEbayPoliciesForToken(token, environment, address)`, get-or-create. `ensureMerchantLocation` first lists the eBay account's existing locations and reuses an `ENABLED` one if present; only creates from `address` if none exists — throws rather than returning a location key that doesn't actually exist (previously silent, caused `errorId 25002`/`25805`). Standalone `npm run setup:policies` builds its own `address` from `.env`'s `EBAY_LOCATION_*` instead (local-only). |
| [envFile.js](server/envFile.js) | `.env` rewriting, local `setup:policies` only. |
| [supabaseClient.js](server/supabaseClient.js) | `supabase` — `service_role` client (`null` if unconfigured), used for all data access. `supabaseAnon` — separate anon/publishable-key client (`null` if `SUPABASE_ANON_KEY` unset), used *only* by `/api/settings/shipping-address/reveal` to verify a password via `signInWithPassword`; RLS deny-all means this client can't read/write any table regardless. |
| [listingsRepository.js](server/listingsRepository.js) | `listings` CRUD, scoped by `userId`. `getRecentListings` skips `description`/`aspects` to cut payload size. `saveListing` now also persists `offerId`/`quantity`/`format` (needed by cancel/quantity routes). `updateListingStatus`/`updateListingQuantity` — the first-ever status-transition mechanism (previously every row stayed `ACTIVE` forever). |
| [ebayTokenCache.js](server/ebayTokenCache.js) | In-memory app/user access-token cache. |
| [oauthStateStore.js](server/oauthStateStore.js) | One-time, 10-min-TTL nonce store for OAuth `state` — prevents account-linking CSRF from a predictable `userId:environment` state. |
| [ebayNotificationVerifier.js](server/ebayNotificationVerifier.js) | Verifies `x-ebay-signature` (tries Production then Sandbox). Uses digest `'sha1'`, not the SDK's `'ssl3-sha1'` (unavailable by default on Node 18+/OpenSSL 3.x). |
| [researchFeeds.js](server/researchFeeds.js) | `searchResearchArticles(query)` — `POST https://google.serper.dev/news` (`X-API-KEY` header, `{q, gl:'jp', hl:'ja'}`). Chosen over Google News RSS (personal-use-only ToS), NewsData.io (200 credits/day + 12h delay), Currents API (thin JP coverage) — Serper.dev resells actual Google results as its core commercial business. Free tier 2,500 queries, ~$1/1,000 after. Throws a clear error if `SERPER_API_KEY` unset. Category queries must be single plain words — `OR`/boolean syntax is read as a literal token, not an operator, and nearly zeroes out results. |

### Database (Supabase)

Postgres + Storage + Auth. Run in SQL Editor:

```sql
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  listing_id text not null,
  offer_id text, -- eBay Offer ID, needed by withdrawOffer (cancel) / bulk_update_price_quantity; null for pre-migration rows
  quantity integer not null default 1,
  listing_format text not null default 'FIXED_PRICE', -- 'FIXED_PRICE' | 'AUCTION'
  title text not null,
  price numeric not null,
  status text not null default 'ACTIVE', -- 'ACTIVE' | 'CANCELLED' | 'SOLD' (SOLD is set manually, no eBay sale webhook)
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

-- active env + each user's own shipping-origin address (single AES-256-GCM-encrypted
-- blob via server/addressCrypto.js — never plaintext, never a shared app-wide value)
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_ebay_env text not null default 'SANDBOX',
  shipping_address_encrypted text,
  updated_at timestamptz not null default now()
);

-- backend always bypasses RLS via service_role, but enable it to block any direct-access path
alter table public.listings enable row level security;
alter table public.ebay_connections enable row level security;
alter table public.user_settings enable row level security;
```

Also create a **Public** Storage bucket named `product-images`.

Migration for an existing project (added after `listings` already existed — category/auction/inventory/cancel feature set):
```sql
alter table public.listings
  add column if not exists offer_id text,
  add column if not exists quantity integer not null default 1,
  add column if not exists listing_format text not null default 'FIXED_PRICE';
```
Existing rows get `offer_id=null` (the cancel/quantity-change routes return a clear 400 for these — "predates this feature, use Seller Hub directly" — rather than failing confusingly against a nonexistent Offer).

Migration for an existing project (added after `user_settings` already existed):
```sql
alter table public.user_settings
  add column if not exists shipping_address_encrypted text;
```
If an even earlier, superseded version stored the address as 5 plaintext columns, drop them:
```sql
alter table public.user_settings
  drop column if exists shipping_address_line1,
  drop column if exists shipping_city,
  drop column if exists shipping_state_or_province,
  drop column if exists shipping_postal_code,
  drop column if exists shipping_country;
```

**Auth setting**: Authentication → Sign In/Providers → Email → "Confirm email" ON = signup requires email confirmation (prod); OFF = instant login (dev).

## eBay integration setup

Sandbox/Production switchable instantly from Settings tab (one user can connect both; no restart/redeploy to switch). Production keyset optional.

**First-time connect** (per environment, once):
1. In eBay Developer Portal, create a keyset and RuName; set "Your auth accepted URL" to `https://<backend-url>/api/ebay/callback` (same URL for both envs).
2. Set `SHIPPING_ADDRESS_ENCRYPTION_KEY` in `.env` (`openssl rand -base64 32`) — required before any user can save a shipping address.
3. Each app user saves **their own** address in Settings tab — required before "eBayでログイン" is clickable. If that eBay account already has a Seller Hub location, the saved address is never used (existing location wins); it only matters for accounts with none yet.
4. Settings → pick Sandbox/Production → "eBayでログイン" → approve. That account becomes the env's connection and is set active immediately; callback auto-runs Business Policy/location setup.
5. Once connected, `/api/publish-ebay` works. Switching between already-connected envs is just the "切り替える" button (no re-auth).

**Marketplace Account Deletion notification** (required for production compliance):
1. Set `EBAY_DELETION_VERIFICATION_TOKEN` (32–80 random alphanumeric chars) and `EBAY_DELETION_ENDPOINT_URL` on Render.
2. Register the same URL/token in Developer Portal → keyset → Notifications → Marketplace Account Deletion (triggers a `challenge_code` handshake).
3. A real deletion notice auto-disconnects via `deleteEbayConnectionsByUsername()`. `ebay_username` is only populated for connections made after this feature shipped.

## Deploy

- **Frontend**: Vercel (auto-detects Vite). Needs `VITE_BACKEND_URL` (defaults to `localhost:3001`) and `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
- **Backend**: Render Web Service ([render.yaml](render.yaml)). `sync: false` vars need manual entry in the dashboard. `PORT` auto-injected. No persistent disk — state lives in Supabase, not `.env`.
- After deploying, update the RuName's "Your auth accepted URL" to the real Render URL.

## Env vars

`.env` is gitignored; see [.env.example](.env.example) for the full list.

| Category | Vars |
|---|---|
| Server | `PORT` / `ALLOWED_ORIGINS` |
| Supabase (backend) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` (same public value as `VITE_SUPABASE_ANON_KEY`, needed server-side only for `/api/settings/shipping-address/reveal`'s password verification — anon keys are safe to expose either way) |
| Supabase (frontend, build-time) | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| AI | `AI_PROVIDER` / `TEXT_AI_PROVIDER` (optional) / `GEMINI_API_KEY` / `GEMINI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` / `GROQ_TEXT_MODEL` (optional) |
| eBay auth | `EBAY_SANDBOX_CLIENT_ID`/`_SECRET`/`_RU_NAME`, `EBAY_PRODUCTION_CLIENT_ID`/`_SECRET`/`_RU_NAME` (Production optional), `EBAY_ENV`/`EBAY_USER_REFRESH_TOKEN` (local `setup:policies` only) |
| eBay listing config | `EBAY_MERCHANT_LOCATION_KEY` / `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID` (local-only fallbacks) / `EBAY_PAYMENT_POLICY_ID` |
| Shipping origin (local `setup:policies` only) | `EBAY_LOCATION_ADDRESS_LINE1` / `_CITY` / `_STATE_OR_PROVINCE` / `_POSTAL_CODE` / `_COUNTRY`. The real app reads each user's own address from `user_settings` instead. |
| Shipping address encryption | `SHIPPING_ADDRESS_ENCRYPTION_KEY` — 32-byte base64, used by `addressCrypto.js`. Required for the address form to work (fails closed). Rotating it makes existing saved addresses undecryptable. |
| eBay deletion webhook | `EBAY_DELETION_VERIFICATION_TOKEN` / `EBAY_DELETION_ENDPOINT_URL` |
| Research tab | `SERPER_API_KEY` (https://serper.dev/ — free 2,500 queries, no card required) |

## Spec deviations

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) assumed Python/FastAPI + OpenAI GPT-4o Vision; actual implementation is Node/Express + Gemini (`@google/genai`, Groq swappable). Endpoint names and snake_case response keys kept aligned with the spec.

## Known limitations

- Market-trend analysis is based only on eBay Browse API's *currently active* listings, not actual sales (Marketplace Insights API needs individual approval, unused).
- Overall score is a snapshot from analysis time; doesn't recompute live as price is adjusted.
- **Shipping origin is per-user but not per-connect**: one address per app user, and `ensureMerchantLocation` is get-or-create — editing the address afterward doesn't retroactively update an eBay-side location that already exists. Earlier the address lived in a single shared `.env` value for the whole app (any connecting user got another user's real address); that was replaced by per-user encrypted storage.
- **No automatic sold-item tracking**: no eBay sale-notification webhook exists, so nothing *automatically* marks a `listings` row `SOLD`. Partially addressed: `POST /api/listings/:id/mark-sold` lets the seller manually flip a row to `SOLD` (from `ListingDetailModal.tsx`) so `totalRevenue`/`soldItemsCount` become meaningful for listings the seller reconciles by hand — still not automatic.
- **Images**: failed upload or mock mode falls back to a `blob:` URL client-side; `/api/publish-ebay` swaps any non-http(s) URL for a placeholder.
- `categoryId` now comes from a real Taxonomy API selection (Step2's category picker, see `getCategorySuggestions`/`getCategoryAspects`) when the user picks one; the `112529` fallback only fires if a client never sends `categoryId` at all (old cached frontend, direct API call, etc).
- **Promoted Listings (advertised listings with a settable ad rate) intentionally not implemented**: would require adding the `sell.marketing` OAuth scope to `USER_SCOPES`, which breaks every already-connected eBay account's next token refresh (all of publish/cancel/quantity-update, not just promotion) until they redo "eBayでログイン" — see [ebayAuth.js](server/ebayAuth.js)'s scope comment. Deferred as its own explicit, opt-in migration rather than bundled with this feature set.
- **Listing cancellation/quantity-change require `offer_id`**: only captured for listings published after this feature shipped (`ListingDetail.canManage`). Older rows show a message directing the seller to Seller Hub instead of a confusing API failure.
- **Auction listings**: eBay may impose per-account eligibility requirements for reserve-price auctions; not verified against a real Sandbox/Production account yet.
- **AI quota**: up to 4 Gemini calls per photo set — hits free-tier limits fast. Groq (`AI_PROVIDER=groq`/`TEXT_AI_PROVIDER=groq`) is the escape hatch ([groqClient.js](server/groqClient.js): vision `qwen/qwen3.6-27b`, text `GROQ_TEXT_MODEL` default `llama-3.3-70b-versatile`; `reasoning_format: 'hidden'` only applied to models matching `REASONING_MODEL_PATTERN = /qwen|deepseek-r1|gpt-oss/i`). `TEXT_AI_PROVIDER=groq` skips the Gemini-only grounded price search entirely and goes straight to the Browse API fallback. Default is Gemini-only; flip both to `groq` when Gemini quota is exhausted, flip back once recovered.
- **Price search returning $0**: fixed by making `runMarketResearchAgent` (whole-internet search) the primary price source instead of eBay-Browse-API-only keyword search, which returned 0 whenever the AI-generated title didn't exactly keyword-match eBay's inventory. The old Browse API path is kept as a secondary fallback.
- Sandbox listing tests and Application Growth Check (raises prod call limits) haven't been done — require the user's own action in Developer Portal.
- **Mobile layout**: `App.tsx`'s phone-frame wrapper is `h-screen h-dvh overflow-hidden` (fixed to viewport) with scrolling moved to inner containers, so `BottomNav` stays pinned regardless of listing count.
- **Mobile zoom-after-login**: `AuthScreen.tsx`'s `handleSubmit` explicitly blurs the focused password input before the async sign-in call, so the keyboard/zoom closes before the DOM swaps to the main app.

## Security

- **CORS**: only `ALLOWED_ORIGINS` + localhost:5173 + prod Vercel URL pattern.
- **Security headers**: `helmet()` (CSP off — two routes return HTML with inline `<script>`; everything else, HSTS/`X-Content-Type-Options`/`X-Frame-Options`/hiding `X-Powered-By`, applies).
- **Rate limiting**: `express-rate-limit` — general 100/min/IP on all `/api/*`, 10/min/IP on `/api/analyze-image`/`/api/publish-ebay`/`/api/ebay/auth-url` (AI-quota/OAuth-abuse-relevant), 5/15min on the address-reveal endpoint (brute-force-relevant).
- **Request body size**: `express.json({ limit: '256kb' })` — explicit rather than Express's undocumented-in-code default.
- **CSRF**: not a concern for this API by design, not by accident — every state-changing request requires an `Authorization: Bearer <Supabase JWT>` header, which a malicious cross-origin page cannot attach; there is no cookie-based session for a CSRF token to protect.
- **XSS**: any user-controlled value interpolated into an HTML response goes through `escapeHtml()`.
- **OAuth CSRF**: `state` is a one-time, 10-min-TTL random nonce, never a raw userId.
- **Deletion-notification authenticity**: verifies `x-ebay-signature` before acting.
- **Upload limits**: 10MB cap, `image/*` only (multer).
- **Ownership on write endpoints**: `/api/listings/:id/cancel`, `/mark-sold`, and `/quantity` all resolve the row via `getListingByListingId(req.userId, id)` first — a guessed `listing_id` belonging to another user 404s rather than being actionable.
- **Auth/data isolation**: every API verifies the Supabase token via `requireAuth` → `req.userId`; all DB access is scoped by `user_id`. RLS is on with no explicit allow policies (default deny-all for `anon`/`authenticated`); only `service_role` (bypasses RLS) reads/writes, always scoped by `req.userId` at the application layer. The frontend never holds a key capable of touching these tables directly.
- **Secrets**: `.env` is gitignored; service_role/client-secret values never reach the frontend.
- **Shipping-address PII**: encrypted at rest beyond Supabase's own disk encryption/RLS, since this is the most sensitive personal data the app stores. AES-256-GCM ([addressCrypto.js](server/addressCrypto.js)) with a key that lives only in `.env`, never in Supabase — defends specifically against a compromised Supabase project (stolen `service_role` key, DB dump). Fail-closed (no plaintext fallback if the key is missing), whole-object encryption (not per-field, so structure isn't observable from ciphertext), never logged (only `userId` + generic error message on decrypt failure), strict server-side validation (length caps, `country` must match `^[A-Z]{2}$`), scoped to `req.userId` only (no client-supplied `userId`), and a `DELETE` endpoint for data minimization. Rotating the key permanently loses previously-saved addresses (no multi-key/versioned decryption — not worth the complexity for this deployment's scale). **API-boundary control, not just at-rest**: `GET /api/settings/shipping-address` returns only `{hasAddress, maskedPreview}` — the plaintext address is returned only by `POST .../reveal`, which requires the account password (verified server-side via a throwaway `supabaseAnon.auth.signInWithPassword` call; the resulting session is discarded, never persisted) — so a valid session token alone is no longer sufficient to read the plaintext address, matching the "harden to the limit" request this feature was built for.
- **Claude Code must not read real user-identifying data**: when debugging live (diagnostic scripts, ad-hoc queries against Supabase via `service_role`), never `SELECT`/print/log `ebay_username`, Supabase Auth emails, or any other real user-identifying field — even though `service_role` technically has access. Restrict live diagnostics to non-identifying signals (row counts, booleans like "connected: true/false", status enums, whether a field is null) or ask the user to check the actual value themselves in Supabase Studio. This applies to one-off debugging scripts as much as to application code — e.g. don't repeat the earlier pattern of a temporary script that printed `ebay_username` values to the terminal while diagnosing the `merchant_location_key` issue.
