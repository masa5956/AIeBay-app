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
薄いシェルで、各画面は[src/components/](src/components/)に分割。`AnalyticsPanel`/`ListingDetailModal`は
`React.lazy`で遅延読み込み（recharts依存の`AnalyticsPanel`だけで約100KB gzip、初期バンドルから分離）。

| コンポーネント | 概要 |
|---|---|
| [AuthScreen.tsx](src/components/AuthScreen.tsx) | ログイン/サインアップ（Supabase Auth）。未ログイン時は`App.tsx`がこれのみ表示 |
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | ホーム。`getListings()`で売上サマリー・最近の出品を表示（マウント時・出品後に再取得）。`isLoading`中はゼロ値をそのまま出さずスケルトン表示（フラッシュ・オブ・ゼロコンテンツ防止） |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | `getAnalytics()`で月別出品額推移・カテゴリ別構成グラフ表示（`React.lazy`で分析タブを開くまで未読み込み） |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | `getEbayStatus()`でSandbox/Production両方の接続状態と現在の有効環境を表示。切替タブでどちらかを選択し、未接続なら「eBayでログイン」(`getEbayAuthUrl(env)`)、接続済みで非アクティブなら「切り替える」(`setActiveEbayEnv(env)`)ボタンを出し分け。モック解析トグル、ログアウトも |
| Step1_ImageUpload〜Step4_Preview | 出品ウィザード（撮影→AI解析結果補正→価格調整→最終確認）。写真は複数枚（最大8枚、`App.tsx`の`MAX_PHOTOS`）選択可能。Step1は選択直後にAI解析を始めず、サムネイル確認・個別削除（×）・追加ができる中間状態を挟んでから「この写真で解析する」ボタンで`onConfirm(files)`を呼ぶ（誤った写真のまま解析してしまうのを防ぐため）。Step2の「追加」ボタンからも撮影済みの元ファイル一式(`selectedFiles`)に追加し全画像で再解析する（`App.tsx`の`runAnalysis()`）。[StepperHeader.tsx](src/components/StepperHeader.tsx)でステップ間移動（解析結果が無いうちはStep2以降不可） |
| [ListingDetailModal.tsx](src/components/ListingDetailModal.tsx) | 最近の出品タップで開く詳細（`getListingDetail(id)`で写真・説明文・aspects取得） |
| [Toast.tsx](src/components/Toast.tsx) / [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx) | 完了・失敗通知 / 出品キャンセル確認 |
| [BottomNav.tsx](src/components/BottomNav.tsx) | ホーム/分析/設定タブ切替 |

- **認証**: [src/services/supabaseClient.ts](src/services/supabaseClient.ts)はpublishable/anonキーのみ使用
  （`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`）。`App.tsx`が`supabase.auth.getSession()`/`onAuthStateChange()`で
  ログイン状態監視。listings等のデータはこのクライアントから直接読み書きせず必ずバックエンド経由
  （`listingService.ts`が各リクエストに`Authorization: Bearer <access_token>`を自動付与）。
- **型定義**: [src/types/listing.ts](src/types/listing.ts)（`ProductData`（`imageUrls: string[]`で複数枚対応）,
  `Condition`, AI分析結果）、[src/types/app.ts](src/types/app.ts)（`TabType`, `RecentListing`, `ListingDetail`,
  `SalesSummary`, `AnalyticsData`, `EbayEnvironment`, `EbayStatus`）。
- **APIクライアント**: [src/services/listingService.ts](src/services/listingService.ts)。`analyzeImageWithAI(files: File[])` /
  `estimatePrice` / `publishToEbay` / `getListings` / `getAnalytics` / `getListingDetail` / `getEbayAuthUrl(env)` /
  `getEbayStatus` / `setActiveEbayEnv(env)`がバックエンド（既定`http://localhost:3001/api`、`VITE_BACKEND_URL`で変更可）を呼ぶ。
  `mockAnalyzeImage`/`mockPublishItem`（[src/mock/mockData.ts](src/mock/mockData.ts)）は設定タブのモックトグル用。

### バックエンド

[server/index.js](server/index.js)（Express、`npm run server`、要`.env`）。`/api/ebay/callback`と
`/api/ebay/deletion-notification`以外は全て[server/authMiddleware.js](server/authMiddleware.js)の`requireAuth`
（`Authorization: Bearer <Supabaseアクセストークン>`を検証し`req.userId`セット、無ければ401）を通過する。
CORSは`ALLOWED_ORIGINS`（+ localhost:5173・`https://a-ie-bay-app*.vercel.app`パターンでVercelの本番/ブランチ/
プレビューURLを包括的に常時許可）で制限、画像アップロードは10MB上限・`image/*`のみ許可（multer）、
HTMLレスポンスへのユーザー入力の埋め込みは`escapeHtml()`でエスケープする。

| Method / Path | 概要 |
|---|---|
| `POST /api/analyze-image` | 画像1〜8枚（`multipart/form-data`の`images`フィールド、複数可）を受け取り、`aiProvider.js`経由でGemini/Groqに全画像まとめてタイトル・ブランド・型番・状態・説明文・aspectsを1つのJSONとして抽出させる。商品状態エージェント（`runConditionAgent`、同じく複数画像対応）とSupabase画像アップロード（`uploadProductImage`を全枚数分）を`Promise.all`で並列実行し、`imageUrls`配列を返す |
| `POST /api/estimate-price` | eBay Browse APIで類似商品検索→IQR外れ値除去→市場トレンド/競合比較エージェント→決定的スコア（`scoreListing`）算出。**Browse APIの検索は出品先環境(Sandbox/Production)とは切り離し、`EBAY_PRODUCTION_CLIENT_ID`等が設定済みなら常にPRODUCTION側で行う**（Sandboxには実商品データがほぼ無く、実商品名で検索してもほぼ確実に0件→価格が常に$0になるため。app tokenでの読み取り専用アクセスなので出品先環境と異なっていても問題ない。Production未設定時のみ現在の出品先環境にフォールバック）。類似商品が0件でも価格を0にするだけで市場トレンド・競合比較・スコア計算自体は必ず実行する（検索キーワードは`analyzeImageWithAI`側でtitleを優先） |
| `POST /api/publish-ebay` | `ebay_connections`のBusiness Policy ID・出荷元ロケーションを使いSell Inventory API（Item→Offer→Publish）で出品。`productData.imageUrls`（複数可）をそのままeBayの`product.imageUrls`に渡す（http(s)以外のURLは除外、1件も無ければプレースホルダー1枚にフォールバック）。必須Item Specifics（Brand/Color/Connectivity/Model/Type、`categoryId=112529`固定）を既定値で補完。成功後`saveListing()`で履歴保存（自アプリの履歴には代表画像1枚(`imageUrls[0]`)のみ保存） |
| `GET /api/listings` | 自分の最近の出品一覧・売上サマリー（ホーム用） |
| `GET /api/listings/:id` | 1件分の全項目（説明文・aspects含む、詳細モーダル用） |
| `GET /api/analytics` | 月別出品額推移（直近6ヶ月）・カテゴリ別構成 |
| `GET /api/ebay/auth-url` | `?env=SANDBOX\|PRODUCTION`（省略時SANDBOX）でeBay同意URLを発行。`createOAuthState()`が発行した使い捨てnonceを`state`にする（`userId`をそのまま埋め込まない） |
| `GET /api/ebay/callback` | eBayからのリダイレクト先（認証対象外）。`consumeOAuthState(state)`でnonceを一度きり消費しuserId/environmentを復元、`exchangeAuthCodeForTokens`→`getEbayUsername`→`setEbayConnection`→`setActiveEbayEnv`（接続した環境に即切替）→`setupEbayPoliciesForToken()`の順で保存・自動セットアップ。`error`クエリパラメータはHTMLエスケープしてから表示（反射型XSS対策） |
| `GET /api/ebay/status` | Sandbox/Production両方の接続状態(`ebayUsername`含む)と現在の有効環境(`activeEnv`)を返す |
| `POST /api/ebay/active-env` | 接続済みの環境へ即時切替（`{ environment }`、未接続なら400）。サーバー再起動・再デプロイ不要 |
| `GET,POST /api/ebay/deletion-notification` | eBay Marketplace Account Deletion通知（認証対象外）。GETはchallenge_code検証、POSTは`verifyEbayNotificationSignature()`で`x-ebay-signature`を検証した上で該当`ebay_username`の`ebay_connections`行を削除し連携解除（署名不一致は412拒否、鍵取得等のインフラ障害時はフェイルオープンでログのみ） |

#### バックエンドモジュール

| ファイル | 役割 |
|---|---|
| [authMiddleware.js](server/authMiddleware.js) | `requireAuth`。Supabaseアクセストークン検証→`req.userId` |
| [aiProvider.js](server/aiProvider.js) | `.env`の`AI_PROVIDER`(`gemini`/`groq`)で画像解析(vision)用エンジンを、`TEXT_AI_PROVIDER`（未設定時`AI_PROVIDER`と同じ）でテキストのみのエージェント用エンジンを独立に選択できる。[geminiClient.js](server/geminiClient.js)/[groqClient.js](server/groqClient.js)を切替。`generateImageJson(promptText, images)`（vision、`AI_PROVIDER`側）と`generateJson()`（テキストのみ、`TEXT_AI_PROVIDER`側）を公開、AI呼び出しは必ずこれ経由。`images`は`[{base64Image, mimeType}, ...]`（1枚以上）で、複数枚を1回のAI呼び出しにまとめて渡し1つの結果に統合させる。`TEXT_AI_PROVIDER=groq`にすると1出品あたりのGemini呼び出しが4回→2回に減る（`runMarketTrendAgent`/`runCompetitorAgent`はvision不要なためGroqに逃がせる） |
| [analysisAgents.js](server/analysisAgents.js) | `runConditionAgent(images)`（状態・欠陥検出、複数枚対応）、`runMarketTrendAgent`/`runCompetitorAgent`（市場トレンド・競合比較。類似出品0件時も空リストとして必ず実行しdemandLevel等を返す）、`scoreListing`（LLM不使用の決定的スコア計算） |
| [priceStats.js](server/priceStats.js) | IQR外れ値除去`removeOutliersByIQR()` |
| [ebayAuth.js](server/ebayAuth.js) | eBay OAuth共通処理。`getEbayEnvConfig(environment)`が`'SANDBOX'`/`'PRODUCTION'`ごとのbaseUrl/authUrl/クライアントID等（`EBAY_SANDBOX_*`/`EBAY_PRODUCTION_*`）を解決し、`getAppAccessToken`/`getUserAccessToken`/`exchangeAuthCodeForTokens`/`getEbayUsername`は全て`environment`引数必須。`getAppAccessToken`/`getUserAccessToken`は[ebayTokenCache.js](server/ebayTokenCache.js)でトークンをキャッシュし、有効期限内は再取得（ネットワーク往復）をスキップする。`getUserAccessToken(userId, environment)`は`ebay_connections`のrefresh_tokenで取得（`userId`省略時`.env`の`EBAY_USER_REFRESH_TOKEN`、`setup:policies`ローカル専用、`environment`省略時`.env`の`EBAY_ENV`）。`USER_SCOPES`(出品/Policy用、refresh grantで常用)と`AUTH_SCOPES`(初回同意専用、`commerce.identity.readonly`追加)を分離—混ぜると既存接続の更新が未同意スコープエラーで壊れるため |
| [ebayConnectionsRepository.js](server/ebayConnectionsRepository.js) | `ebay_connections`のCRUD、全関数`environment`引数必須（1ユーザーがSandbox/Production同時接続可）。`getEbayConnection`/`getEbayRefreshToken`/`setEbayConnection`/`getAllEbayConnections`(両環境まとめて取得)/`deleteEbayConnectionsByUsername`(環境問わずusername一致で削除) |
| [userSettingsRepository.js](server/userSettingsRepository.js) | `user_settings`のCRUD。`getActiveEbayEnv(userId)`/`setActiveEbayEnv(userId, environment)`—ユーザーが今どちらの環境で出品するかを保持（未設定時`'SANDBOX'`） |
| [setupPolicies.js](server/setupPolicies.js) | `ensureBusinessPolicyOptIn`/`ensureFulfillmentPolicy`/`ensureReturnPolicy`/`ensureMerchantLocation`（get-or-create、全て`environment`引数必須）をまとめた`setupEbayPoliciesForToken(token, environment)`。callback自動実行の他`npm run setup:policies`でも単独動作（`.env`の`EBAY_ENV`使用、`isDirectRun`ガード） |
| [envFile.js](server/envFile.js) | `.env`書き換え`updateEnvValue()`（`setup:policies`ローカル実行専用） |
| [supabaseClient.js](server/supabaseClient.js) | `service_role`キー使用。未設定時`supabase`は`null`（関連機能のみスキップ、サーバーは落ちない） |
| [listingsRepository.js](server/listingsRepository.js) | `listings`のCRUD、全関数`userId`必須・`.eq('user_id', userId)`（`saveListing`/`getRecentListings`/`getListingByListingId`/`getSalesSummary`/`getAnalytics`）。`getRecentListings`は一覧に不要な`description`/`aspects`を除いた列のみ選択（転送量削減、詳細は`getListingByListingId`で全列取得） |
| [ebayTokenCache.js](server/ebayTokenCache.js) | eBay app/userアクセストークンのメモリキャッシュ（`expires_in`ベース、60秒の安全マージン付き）。`/api/estimate-price`・`/api/publish-ebay`を呼ぶたびに毎回リフレッシュ通信していたのを解消（キャッシュヒット時は実測0.数ms、ミス時は約350ms） |
| [oauthStateStore.js](server/oauthStateStore.js) | eBay OAuthの`state`用、使い捨て・10分有効期限付きのランダムnonceストア（メモリ保持）。`createOAuthState(userId, environment)`/`consumeOAuthState(nonce)`（取得と同時に削除、リプレイ不可）。予測可能な`userId:environment`を直接stateにしないためのCSRF/アカウント紐付け偽装対策 |
| [ebayNotificationVerifier.js](server/ebayNotificationVerifier.js) | `verifyEbayNotificationSignature(body, signatureHeader)`。`x-ebay-signature`ヘッダー（base64→JSON、`{kid, signature}`）をeBayの公開鍵API（Sandbox/Production両方を試行）で検証し、削除通知の偽装を防ぐ。実装は[eBay公式Node SDK](https://github.com/eBay/event-notification-nodejs-sdk)準拠（アルゴリズムは`'ssl3-sha1'`ではなくOpenSSL 3.x/Node18+互換の`'sha1'`を使用） |

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

-- ユーザー×環境(SANDBOX/PRODUCTION)ごとの接続情報。1ユーザーが両方を同時に接続できる
create table public.ebay_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null default 'SANDBOX',
  refresh_token text not null,
  fulfillment_policy_id text,
  return_policy_id text,
  merchant_location_key text,
  ebay_username text, -- アカウント削除通知の突合用
  updated_at timestamptz not null default now(),
  primary key (user_id, environment)
);

-- ユーザーごとに「今どちらの環境で出品するか」を保持（設定タブからの即時切替用）
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_ebay_env text not null default 'SANDBOX',
  updated_at timestamptz not null default now()
);

-- バックエンドはservice_roleキーで常にRLSをバイパスするが、直接アクセス経路を塞ぐため有効化
alter table public.listings enable row level security;
alter table public.ebay_connections enable row level security;
alter table public.user_settings enable row level security;
```

既に`ebay_connections`が`user_id`単独主キーで存在する場合のマイグレーション:
```sql
alter table public.ebay_connections drop constraint ebay_connections_pkey;
alter table public.ebay_connections add column environment text not null default 'SANDBOX';
alter table public.ebay_connections add primary key (user_id, environment);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_ebay_env text not null default 'SANDBOX',
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
```

Storageに`product-images`という**Public**バケットも作成（撮影画像の公開URL用）。

**Authentication設定**: 「Authentication」→「Sign In / Providers」→「Email」の「Confirm email」有効=サインアップ時
確認メール必須（本番向け）、無効=即ログイン（開発向け）。

## eBay連携セットアップ

Sandbox/Productionは設定タブから即時切替可能（1ユーザーが両方を同時に接続でき、切替にサーバー再起動・
再デプロイ不要）。Productionのキーセットが無い/無効でもSandboxのみで全機能が動作する。

**初回接続**（`.env`のAPIキー設定だけでは出品不可、環境ごとに一度だけ）:
1. eBay Developer Portalで対象環境（Sandbox/Production）のキーセット（`EBAY_SANDBOX_CLIENT_ID`等 /
   `EBAY_PRODUCTION_CLIENT_ID`等）とRuNameを作成し、「Your auth accepted URL」に
   `https://<バックエンド公開URL>/api/ebay/callback`を設定（httpsのlocalhostが使えない場合ngrok等、
   Sandbox/Productionで別々のRuName・別々のURLを登録する必要はなく同一URLでよい）。
2. `.env`の`EBAY_LOCATION_*`に出荷元住所を設定（アプリ全体・両環境で共有の単一設定）。
3. アプリにログイン→設定タブ→環境タブでSandbox/Productionを選択→「eBayでログイン」→eBay同意画面で許可
   （**同意したeBayアカウントでその環境が接続され、自動的に出品先として切り替わる**）。`/api/ebay/callback`が
   Business Policies・出荷元ロケーションの自動セットアップまで一括実行、再起動不要。
4. 設定タブでその環境の接続状態が「接続中」になれば`/api/publish-ebay`が実行可能。既に両方接続済みなら、
   設定タブの「切り替える」ボタンでOAuthをやり直さずに即座に出品先を変更できる。

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
| サーバー | `PORT` / `ALLOWED_ORIGINS`（CORS許可オリジンの追加、カンマ区切り。localhost:5173と本番Vercel URLは常時許可） |
| Supabase(バックエンド) | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase(フロントエンド、ビルド埋込) | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| AI | `AI_PROVIDER` / `TEXT_AI_PROVIDER`（任意、テキスト専用エージェントだけ別エンジンにする場合） / `GEMINI_API_KEY` / `GEMINI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` |
| eBay認証 | `EBAY_SANDBOX_CLIENT_ID` / `EBAY_SANDBOX_CLIENT_SECRET` / `EBAY_SANDBOX_RU_NAME` / `EBAY_PRODUCTION_CLIENT_ID` / `EBAY_PRODUCTION_CLIENT_SECRET` / `EBAY_PRODUCTION_RU_NAME`（Production未取得ならSandboxのみ空でなく設定すればよい） / `EBAY_ENV` / `EBAY_USER_REFRESH_TOKEN`(いずれも`setup:policies`ローカル専用) |
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
- **商品画像**: アップロード失敗時・モックモード時（`useMockAnalysis`ON、AI呼び出しをスキップしダミーデータで代用する開発者向けトグル）は`blob:`にフォールバックし、`/api/publish-ebay`側でプレースホルダー画像（`https://placehold.co/500x500.png`）に強制差し替える暫定対応あり。
- `categoryId`は仮の固定値(`112529`)。実運用にはTaxonomy API等での適切なカテゴリ判定が必要。
- **AI APIクォータ**: 画像1枚あたり最大4回のAI呼び出し（基本抽出・状態・市場トレンド・競合比較）が発生し無料枠の制限に達しやすい。Gemini→Groq切替は`aiProvider.js`参照。
- Sandbox出品テスト・Application Growth Check(AGC)申請（本番呼び出し上限引き上げ）は未着手。eBay Developer Portal上でユーザー自身が行う必要がある。

## セキュリティ対策

- **CORS**: `ALLOWED_ORIGINS`（+ localhost:5173・本番Vercel URL）以外のオリジンからのfetch/XHRは拒否。
- **XSS対策**: `/api/ebay/callback`のエラーメッセージ等、ユーザー入力由来の値をHTMLに埋め込む箇所は`escapeHtml()`で必ずエスケープする。
- **OAuth CSRF対策**: `state`パラメータは`oauthStateStore.js`が発行する使い捨て・10分有効期限のランダムnonce（`userId`を直接含めない）。他人のSupabaseユーザーIDを知っているだけではアカウントを紐付けられない。
- **削除通知の真正性検証**: `POST /api/ebay/deletion-notification`は`ebayNotificationVerifier.js`で`x-ebay-signature`ヘッダーを検証し、eBay以外からの偽装リクエストで他人のeBay連携を強制切断されないようにする。
- **アップロード制限**: 画像アップロードは10MB上限・`image/*`のみ許可（multer）。
- **認証・データ分離**: 全APIは`requireAuth`でSupabaseアクセストークンを検証し`req.userId`をセット、DBアクセスは全て`user_id`（`ebay_connections`は`user_id, environment`）でスコープする。RLSは有効化済みだがバックエンドは`service_role`で常時バイパスする設計のため、実質的なアクセス制御はアプリケーション層のこのスコープ処理が担う。
- **秘密情報**: `.env`はgit管理対象外、service_role/クライアントシークレット等はフロントエンドに一切渡さない。
