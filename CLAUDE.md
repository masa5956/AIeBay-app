# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定
常に日本語で会話・コメント・エラー説明・ドキュメントを記述する。

## プロジェクト概要

eBay向けAI自動出品ツール。スマホ画面風のReact SPAで、商品写真をGemini/Groq(Vision)が解析し、複数AIエージェント
（市場トレンド・競合比較・商品状態分析）を経てeBayに出品するウィザードUIを提供する。**Supabase Auth（メール+
パスワード）のアプリ独自アカウントでログインし、出品履歴・売上・接続eBayアカウントはユーザーごとに分離される**
（マルチユーザー対応）。詳細要件は[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md)（実装との差異は末尾参照）。

## よく使うコマンド

```bash
npm run dev            # Vite開発サーバー（フロントエンドのみ）
npm run server         # server/index.js のExpressバックエンド（要.env、別ターミナル）
npm run build          # tsc → vite build
npm run preview        # ビルド済みアプリをローカルプレビュー
npm run lint           # oxlint
npm run setup:policies # eBay Business Policies・出荷元ロケーションの初回セットアップ
```

`dev`と`server`を両方起動して初めて出品フローが動作する。テストは未設定。

## アーキテクチャ

### フロントエンド

Vite + React18 + TS + Tailwind + `lucide-react` + `recharts`。[App.tsx](src/App.tsx)は状態管理と画面組み立てのみの
薄いシェルで、各画面は[src/components/](src/components/)に分割。

| コンポーネント | 概要 |
|---|---|
| [AuthScreen.tsx](src/components/AuthScreen.tsx) | ログイン/サインアップ（Supabase Auth）。未ログイン時は`App.tsx`がこれのみ表示 |
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | ホーム。`getListings()`で売上サマリー・最近の出品を表示（マウント時・出品後に再取得） |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | `getAnalytics()`で月別出品額推移・カテゴリ別構成グラフ表示 |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | `getEbayStatus()`/`getEbayAuthUrl()`でeBay接続状態表示・「eBayでログイン」ボタン、モック解析トグル、ログアウト |
| Step1_ImageUpload〜Step4_Preview | 出品ウィザード（撮影→AI解析結果補正→価格調整→最終確認）。[StepperHeader.tsx](src/components/StepperHeader.tsx)でステップ間移動（解析結果が無いうちはStep2以降不可） |
| [ListingDetailModal.tsx](src/components/ListingDetailModal.tsx) | 最近の出品タップで開く詳細（`getListingDetail(id)`で写真・説明文・aspects取得） |
| [Toast.tsx](src/components/Toast.tsx) / [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx) | 完了・失敗通知 / 出品キャンセル確認 |
| [BottomNav.tsx](src/components/BottomNav.tsx) | ホーム/分析/設定タブ切替 |

- **認証**: [src/services/supabaseClient.ts](src/services/supabaseClient.ts)はpublishable/anonキーのみ使用
  （`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`）。`App.tsx`が`supabase.auth.getSession()`/`onAuthStateChange()`で
  ログイン状態監視。listings等のデータはこのクライアントから直接読み書きせず必ずバックエンド経由
  （`listingService.ts`が各リクエストに`Authorization: Bearer <access_token>`を自動付与）。
- **型定義**: [src/types/listing.ts](src/types/listing.ts)（`ProductData`, `Condition`, AI分析結果）、
  [src/types/app.ts](src/types/app.ts)（`TabType`, `RecentListing`, `ListingDetail`, `SalesSummary`, `AnalyticsData`）。
- **APIクライアント**: [src/services/listingService.ts](src/services/listingService.ts)。`analyzeImageWithAI` /
  `estimatePrice` / `publishToEbay` / `getListings` / `getAnalytics` / `getListingDetail` / `getEbayAuthUrl` /
  `getEbayStatus`がバックエンド（既定`http://localhost:3001/api`、`VITE_BACKEND_URL`で変更可）を呼ぶ。
  `mockAnalyzeImage`/`mockPublishItem`（[src/mock/mockData.ts](src/mock/mockData.ts)）は設定タブのモックトグル用。

### バックエンド

[server/index.js](server/index.js)（Express、`npm run server`、要`.env`）。`/api/ebay/callback`と
`/api/ebay/deletion-notification`以外は全て[server/authMiddleware.js](server/authMiddleware.js)の`requireAuth`
（`Authorization: Bearer <Supabaseアクセストークン>`を検証し`req.userId`セット、無ければ401）を通過する。

| Method / Path | 概要 |
|---|---|
| `POST /api/analyze-image` | `aiProvider.js`経由でGemini/Groqにタイトル・ブランド・型番・状態・説明文・aspectsをJSON抽出させ、商品状態エージェント（`runConditionAgent`）とSupabase画像アップロード（`uploadProductImage`）を`Promise.all`で並列実行 |
| `POST /api/estimate-price` | eBay Browse APIで類似商品検索→IQR外れ値除去→市場トレンド/競合比較エージェント→決定的スコア（`scoreListing`）算出 |
| `POST /api/publish-ebay` | `ebay_connections`のBusiness Policy ID・出荷元ロケーションを使いSell Inventory API（Item→Offer→Publish）で出品。必須Item Specifics（Brand/Color/Connectivity/Model/Type、`categoryId=112529`固定）を既定値で補完。成功後`saveListing()`で履歴保存 |
| `GET /api/listings` | 自分の最近の出品一覧・売上サマリー（ホーム用） |
| `GET /api/listings/:id` | 1件分の全項目（説明文・aspects含む、詳細モーダル用） |
| `GET /api/analytics` | 月別出品額推移（直近6ヶ月）・カテゴリ別構成 |
| `GET /api/ebay/auth-url` | eBay同意URL発行。`userId`を`state`に埋め込みcallbackでの判別に使う |
| `GET /api/ebay/callback` | eBayからのリダイレクト先（認証対象外）。`state`のuserIdでユーザー特定、`exchangeAuthCodeForTokens`→`getEbayUsername`→`setEbayConnection`→`setupEbayPoliciesForToken()`の順で保存・自動セットアップ |
| `GET /api/ebay/status` | eBay接続済みかどうか |
| `GET,POST /api/ebay/deletion-notification` | eBay Marketplace Account Deletion通知（認証対象外）。GETはchallenge_code検証、POSTは該当`ebay_username`の`ebay_connections`行を削除し連携解除 |

#### バックエンドモジュール

| ファイル | 役割 |
|---|---|
| [authMiddleware.js](server/authMiddleware.js) | `requireAuth`。Supabaseアクセストークン検証→`req.userId` |
| [aiProvider.js](server/aiProvider.js) | `.env`の`AI_PROVIDER`(`gemini`/`groq`)で[geminiClient.js](server/geminiClient.js)/[groqClient.js](server/groqClient.js)切替。`generateJson()`/`generateImageJson()`を公開、AI呼び出しは必ずこれ経由 |
| [analysisAgents.js](server/analysisAgents.js) | `runConditionAgent`（状態・欠陥検出）、`runMarketTrendAgent`/`runCompetitorAgent`（市場トレンド・競合比較）、`scoreListing`（LLM不使用の決定的スコア計算） |
| [priceStats.js](server/priceStats.js) | IQR外れ値除去`removeOutliersByIQR()` |
| [ebayAuth.js](server/ebayAuth.js) | eBay OAuth共通処理。`getUserAccessToken(userId)`は`ebay_connections`のrefresh_tokenで取得（省略時`.env`の`EBAY_USER_REFRESH_TOKEN`、`setup:policies`ローカル専用）。`USER_SCOPES`(出品/Policy用、refresh grantで常用)と`AUTH_SCOPES`(初回同意専用、`commerce.identity.readonly`追加)を分離— 混ぜると既存接続の更新が未同意スコープエラーで壊れるため。`getEbayUsername()`は削除通知突合用 |
| [ebayConnectionsRepository.js](server/ebayConnectionsRepository.js) | `ebay_connections`のCRUD（`getEbayConnection`/`getEbayRefreshToken`/`setEbayConnection`/`deleteEbayConnectionsByUsername`） |
| [setupPolicies.js](server/setupPolicies.js) | `ensureBusinessPolicyOptIn`/`ensureFulfillmentPolicy`/`ensureReturnPolicy`/`ensureMerchantLocation`（get-or-create）をまとめた`setupEbayPoliciesForToken(token)`。callback自動実行の他`npm run setup:policies`でも単独動作（`isDirectRun`ガード） |
| [envFile.js](server/envFile.js) | `.env`書き換え`updateEnvValue()`（`setup:policies`ローカル実行専用） |
| [supabaseClient.js](server/supabaseClient.js) | `service_role`キー使用。未設定時`supabase`は`null`（関連機能のみスキップ、サーバーは落ちない） |
| [listingsRepository.js](server/listingsRepository.js) | `listings`のCRUD、全関数`userId`必須・`.eq('user_id', userId)`（`saveListing`/`getRecentListings`/`getListingByListingId`/`getSalesSummary`/`getAnalytics`） |

### データベース（Supabase）

Postgres + Storage + Auth使用。SQL Editorで実行:

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

create table public.ebay_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  fulfillment_policy_id text,
  return_policy_id text,
  merchant_location_key text,
  ebay_username text, -- アカウント削除通知の突合用
  updated_at timestamptz not null default now()
);

-- バックエンドはservice_roleキーで常にRLSをバイパスするが、直接アクセス経路を塞ぐため有効化
alter table public.listings enable row level security;
alter table public.ebay_connections enable row level security;
```

Storageに`product-images`という**Public**バケットも作成（撮影画像の公開URL用）。

**Authentication設定**: 「Authentication」→「Sign In / Providers」→「Email」の「Confirm email」有効=サインアップ時
確認メール必須（本番向け）、無効=即ログイン（開発向け）。

## eBay連携セットアップ

**初回接続**（`.env`のAPIキー設定だけでは出品不可、一度だけ）:
1. eBay Developer Portalでキーセット（`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`）とRuName（`EBAY_RU_NAME`）を作成し、
   「Your auth accepted URL」に`https://<バックエンド公開URL>/api/ebay/callback`を設定（httpsのlocalhostが使えない場合ngrok等）。
2. `.env`の`EBAY_LOCATION_*`に出荷元住所を設定（アプリ全体で共有の単一設定）。
3. アプリにログイン→設定タブ→「eBayでログイン」→eBay同意画面で許可（**同意したeBayアカウントで以後出品される**）。
   `/api/ebay/callback`がBusiness Policies・出荷元ロケーションの自動セットアップまで一括実行、再起動不要。
4. 設定タブのeBay連携状態が「接続中」になれば`/api/publish-ebay`が実行可能。

**Marketplace Account Deletion通知**（本番運用の必須コンプライアンス対応、Webhookエンドポイント実装済み）:
1. `EBAY_DELETION_VERIFICATION_TOKEN`（32〜80文字の英数字乱数、例`openssl rand -hex 32`）と
   `EBAY_DELETION_ENDPOINT_URL`（`https://<公開URL>/api/ebay/deletion-notification`）をRenderの環境変数に設定。
2. eBay Developer Portalの対象キーセット→「Notifications」→Marketplace Account Deletion設定で同じURL/トークンを登録
   （保存時にeBayが`challenge_code`付きGETで疎通確認、`GET /api/ebay/deletion-notification`のsha256応答と一致すればOK）。
3. 以後、接続中アカウントが削除・閉鎖されるとPOST通知が届き`deleteEbayConnectionsByUsername()`が自動で連携解除する。
   ※`ebay_username`はこの機能実装後に「eBayでログイン」したアカウントのみ保存される（それ以前の接続は`null`のまま突合対象外、再ログインで補完）。

## デプロイ

- **フロントエンド**: Vercel（Vite自動検出、GitHub連携）。環境変数`VITE_BACKEND_URL`（Renderの公開URL、
  [listingService.ts](src/services/listingService.ts)参照、未設定時`localhost:3001`）、`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`必須。
- **バックエンド**: Render（Web Service、[render.yaml](render.yaml)にBlueprint定義済み）。`sync: false`の環境変数は
  ダッシュボードで手動入力（[.env.example](.env.example)参照）。`PORT`は自動注入。永続ディスクが無いため
  トークン等はダッシュボードの環境変数として保存（DB保存に切替済みのため`.env`書き換えは基本不要）。
- デプロイ後、eBay Developer PortalのRuNameの「Your auth accepted URL」を実際のRender公開URLに変更する。

## 環境変数

`.env`はGit管理対象外。値は[.env.example](.env.example)参照、Google AI Studio/Groq Console/Supabase/eBay Developerで取得。

| カテゴリ | 変数 |
|---|---|
| サーバー | `PORT` |
| Supabase(バックエンド) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase(フロントエンド、ビルド埋込) | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| AI | `AI_PROVIDER` / `GEMINI_API_KEY` / `GEMINI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` |
| eBay認証 | `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_RU_NAME` / `EBAY_ENV` / `EBAY_USER_REFRESH_TOKEN`(`setup:policies`ローカル専用) |
| eBay出品設定 | `EBAY_MERCHANT_LOCATION_KEY` / `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID`(いずれも`setup:policies`ローカル専用) / `EBAY_PAYMENT_POLICY_ID` |
| 出荷元住所 | `EBAY_LOCATION_ADDRESS_LINE1` / `EBAY_LOCATION_CITY` / `EBAY_LOCATION_STATE_OR_PROVINCE` / `EBAY_LOCATION_POSTAL_CODE` / `EBAY_LOCATION_COUNTRY` |
| eBay削除通知 | `EBAY_DELETION_VERIFICATION_TOKEN` / `EBAY_DELETION_ENDPOINT_URL` |

## 仕様書との差異

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md)はPython/FastAPI・OpenAI GPT-4o Vision想定だが、実装は
Node.js/Express + Gemini（`@google/genai`、Groq切替可）。エンドポイント名・レスポンスキー命名規則(snake_case)は仕様書に合わせた。

## 既知の制約・未実装

- 市場トレンド分析はeBay Browse APIの「現在アクティブな出品」のみが根拠（売却実績データではない、Marketplace Insights APIは個別承認制のため未使用）。
- 総合判定スコアはAI解析直後の一時点スナップショット。価格を後から調整してもリアルタイム再計算はしない。
- 出荷元住所はアプリ全体で共有の単一設定（Business Policies自体はユーザーごとのeBayアカウントに個別作成）。
- **売上実績の追跡なし**: `listings`の「売却済み(SOLD)」への更新機構が無く全出品ACTIVEのまま記録され続けるため、`totalRevenue`/`monthlyRevenue`/`soldItemsCount`は常に0、月次売上バッジも非表示のまま。実運用にはeBay売却通知（Webhook等）受信の仕組みが必要。
- **商品画像**: アップロード失敗時・モックモード時は`blob:`にフォールバックし、`/api/publish-ebay`側でプレースホルダー画像に強制差し替える暫定対応あり。
- `categoryId`は仮の固定値(`112529`)。実運用にはTaxonomy API等での適切なカテゴリ判定が必要。
- **AI APIクォータ**: 画像1枚あたり最大4回のAI呼び出し（基本抽出・状態・市場トレンド・競合比較）が発生し無料枠の制限に達しやすい。Gemini→Groq切替は`aiProvider.js`参照。
- Sandbox出品テスト・Application Growth Check(AGC)申請（本番呼び出し上限引き上げ）は未着手。eBay Developer Portal上でユーザー自身が行う必要がある。
