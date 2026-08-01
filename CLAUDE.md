# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定
- 常に日本語で会話する
- コメントも日本語で記述する
- エラーメッセージの説明も日本語で行う
- ドキュメントも日本語で生成する

## プロジェクト概要

eBay向けのAI自動出品ツール。スマートフォン画面を模したReact SPAで、商品写真をアップロードすると
Gemini（Vision）またはGroq（Vision）が画像解析を行い、複数のAIエージェントが市場トレンド・競合比較・商品状態を
多角的に分析した上でeBayに出品するまでのウィザードUIを提供する。**Supabase Authによるアプリ独自のアカウント
（メールアドレス+パスワード）でログインする必要があり、出品履歴・売上サマリー・分析グラフ・接続するeBayアカウントは
すべてログインユーザーごとに分離される**（マルチユーザー対応）。詳細な要件・API契約は
[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) を参照。

## よく使うコマンド

```bash
npm run dev            # Vite開発サーバーを起動（フロントエンドのみ）
npm run server         # server/index.js のExpressバックエンドを起動（要 .env、別ターミナルで実行）
npm run build          # tsc（型チェック）→ vite build
npm run preview        # ビルド済みアプリをローカルでプレビュー
npm run lint           # oxlint による静的解析
npm run setup:policies # eBay Business Policies・出荷元ロケーションの初回セットアップ
```

- フロントエンドは `npm run dev` と `npm run server` を両方起動して初めて実際の出品フローが動作する。
- テストフレームワーク／テストスクリプトは未設定（テストは存在しない）。

## アーキテクチャ

### フロントエンド

Vite + React 18 + TypeScript + Tailwind CSS + `lucide-react`（アイコン） + `recharts`（グラフ）。
**[App.tsx](src/App.tsx) は状態管理と画面組み立てのみを行う薄いシェル**で、各画面のJSXは
[src/components/](src/components/) 以下に分割されている。

| 画面/コンポーネント | 概要 |
|---|---|
| [AuthScreen.tsx](src/components/AuthScreen.tsx) | アプリ独自のログイン/サインアップ画面（Supabase Auth、メール+パスワード）。未ログイン時は`App.tsx`がこれだけを表示する |
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | ホーム。`getListings()`で取得した売上サマリー・最近の出品を表示（マウント時・出品成功後に再取得） |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | 分析。`getAnalytics()`による月別出品額推移・カテゴリ別出品額構成グラフを表示 |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | 設定。`getEbayStatus()`で取得した実際のeBay接続状態表示と「eBayでログイン」ボタン（`getEbayAuthUrl()`の同意URLへ遷移、完了後はどのeBayアカウントでログインしたかに応じてそのアカウントで出品される）、開発者向け「AI解析をモックデータで代用」トグル、ログアウトボタン |
| [Step1_ImageUpload.tsx](src/components/Step1_ImageUpload.tsx)〜[Step4_Preview.tsx](src/components/Step4_Preview.tsx) | 出品ウィザード（撮影→AI解析結果補正→価格調整→最終確認）。[StepperHeader.tsx](src/components/StepperHeader.tsx)クリックでステップ間移動可（解析結果が無いうちはStep2以降へ移動不可） |
| [ListingDetailModal.tsx](src/components/ListingDetailModal.tsx) | ホームの「最近の出品」をタップすると開く詳細モーダル。`getListingDetail(id)`で写真・説明文・商品仕様(aspects)を取得して表示 |
| [Toast.tsx](src/components/Toast.tsx) / [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx) | 完了・失敗通知 / 出品キャンセル確認 |
| [BottomNav.tsx](src/components/BottomNav.tsx) | ホーム/分析/設定のタブ切替 |

- **認証**: [src/services/supabaseClient.ts](src/services/supabaseClient.ts)がpublishable/anonキーのみを使う
  フロントエンド用Supabaseクライアント（`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`）。`App.tsx`が
  `supabase.auth.getSession()` / `onAuthStateChange()`でログイン状態を監視し、未ログイン時は
  [AuthScreen.tsx](src/components/AuthScreen.tsx)のみを表示する。listings等のデータはこのクライアントから
  直接読み書きせず、必ずExpressバックエンド経由でアクセスする（`listingService.ts`が各リクエストに
  `Authorization: Bearer <access_token>`を自動付与）。
- **型定義**: [src/types/listing.ts](src/types/listing.ts)（`ProductData`, `Condition`, AIマルチエージェント分析結果の型）、
  [src/types/app.ts](src/types/app.ts)（`TabType`, `RecentListing`, `ListingDetail`, `SalesSummary`, `AnalyticsData`）。
- **APIクライアント層**: [src/services/listingService.ts](src/services/listingService.ts)。
  `analyzeImageWithAI` / `estimatePrice` / `publishToEbay` / `getListings` / `getAnalytics` / `getListingDetail` /
  `getEbayAuthUrl` / `getEbayStatus`がバックエンド（既定`http://localhost:3001/api`、`VITE_BACKEND_URL`で変更可）を
  呼び出す実装。`mockAnalyzeImage` / `mockPublishItem`（[src/mock/mockData.ts](src/mock/mockData.ts)のサンプル
  データ）は設定タブのモックトグルやオフライン確認用。

### バックエンド

[server/index.js](server/index.js)（Express、`npm run server`で起動、要`.env`）が公開するエンドポイント。
`/api/ebay/callback`以外は全て[server/authMiddleware.js](server/authMiddleware.js)の`requireAuth`ミドルウェアを
通過する必要があり、フロントエンドが送る`Authorization: Bearer <Supabaseアクセストークン>`を検証して
`req.userId`をセットする（無ければ401を返す）:

| Method / Path | 概要 |
|---|---|
| `POST /api/analyze-image` | 画像を`aiProvider.js`経由でGemini/Groqに渡しタイトル・ブランド・型番・状態・説明文・商品仕様(aspects)をJSON抽出。商品状態エージェント（`runConditionAgent`）とSupabase Storageへの画像アップロード（`uploadProductImage`）を`Promise.all`で並列実行 |
| `POST /api/estimate-price` | eBay Browse APIで類似商品検索→IQRで外れ値除去した価格統計＋市場トレンド/競合比較エージェント＋決定的な総合判定スコア（`scoreListing`）を算出 |
| `POST /api/publish-ebay` | ログインユーザーが接続したeBayアカウント（`ebay_connections`）のBusiness Policy ID・出荷元ロケーションキーを使い、Sell Inventory API（Inventory Item→Offer→Publish）で出品確定。必須Item Specifics（Brand/Color/Connectivity/Model/Type、フォールバックの`categoryId=112529`が要求）を既定値で補完。成功後`saveListing()`でSupabaseにユーザー紐付きで履歴保存 |
| `GET /api/listings` | ログインユーザー自身の`listings`から最近の出品一覧・売上サマリーを取得（ホーム画面用） |
| `GET /api/listings/:id` | ログインユーザー自身の出品から`listing_id`を指定して1件分の全項目（説明文・商品仕様含む）を取得（出品詳細モーダル用） |
| `GET /api/analytics` | ログインユーザー自身の月別出品額推移（直近6ヶ月）・カテゴリ別出品額構成を集計（分析タブ用） |
| `GET /api/ebay/auth-url` | eBay同意画面のURLを発行。ログインユーザーのIDを`state`パラメータに埋め込み、`callback`でどのアプリユーザーの接続かを判別できるようにする |
| `GET /api/ebay/callback` | eBayからのリダイレクト先。`state`（`req.userId`ではなくクエリのuserId）を使ってユーザーを特定し、`refresh_token`取得後に`setupEbayPoliciesForToken()`でBusiness Policies/出荷元ロケーションを自動セットアップし、まとめて`ebay_connections`に保存する。認証ミドルウェアの対象外（eBayからの素のブラウザリダイレクトのためAuthorizationヘッダーを付与できない） |
| `GET /api/ebay/status` | ログインユーザーがeBayアカウントを接続済みかどうかを返す |

**主要な既知の制約**（詳細は[未実装・要注意な箇所](#未実装要注意な箇所)を参照）:
- 市場トレンド分析は、eBay Browse APIの「現在アクティブな出品」のみに基づく需要推定であり、
  実際の売却実績データではない（Marketplace Insights APIは個別承認制のため未使用）。
- 総合判定スコアはAI解析直後の一時点のスナップショットで、価格を後から調整してもリアルタイム再計算はしない。
- 出荷元住所（`EBAY_LOCATION_*`）はアプリ全体で共有の単一設定であり、ユーザーごとに異なる出荷元を
  持たせる機能は無い（Business Policies自体はユーザーごとのeBayアカウントに対して個別に自動作成される）。

#### バックエンドモジュール

| ファイル | 役割 |
|---|---|
| [server/authMiddleware.js](server/authMiddleware.js) | `requireAuth`ミドルウェア。`Authorization`ヘッダーのSupabaseアクセストークンを`supabase.auth.getUser()`で検証し`req.userId`をセット。各APIエンドポイントのユーザーデータ分離の基盤 |
| [server/aiProvider.js](server/aiProvider.js) | `.env`の`AI_PROVIDER`（`gemini`/`groq`）で[geminiClient.js](server/geminiClient.js)/[groqClient.js](server/groqClient.js)を切替える共通レイヤー。`generateJson()` / `generateImageJson()`を公開し、`index.js`・`analysisAgents.js`はこれ経由でのみAIを呼ぶ（Geminiのレート制限時はサーバー再起動だけでGroqに切替可能） |
| [server/geminiClient.js](server/geminiClient.js) | Geminiクライアント（`GoogleGenAI`）と`GEMINI_MODEL`定数 |
| [server/groqClient.js](server/groqClient.js) | Groqクライアント（`groq-sdk`）と`GROQ_MODEL`定数（既定`meta-llama/llama-4-scout-17b-16e-instruct`）。画像入力時は`response_format`を指定せず`parseJsonLoose()`で緩くJSON抽出 |
| [server/analysisAgents.js](server/analysisAgents.js) | `runConditionAgent`（商品状態・欠陥検出）、`runMarketTrendAgent` / `runCompetitorAgent`（市場トレンド・競合比較）、`scoreListing`（LLM不使用の決定的な重み付け計算による総合スコア） |
| [server/priceStats.js](server/priceStats.js) | IQR外れ値除去`removeOutliersByIQR()`。`/api/estimate-price`が使用 |
| [server/ebayAuth.js](server/ebayAuth.js) | eBay OAuth共通処理（アプリ/ユーザートークン取得、認可コード交換）。`getUserAccessToken(userId)`はSupabaseの`ebay_connections`からそのユーザーが接続したeBayアカウントのrefresh_tokenを取得する。`userId`省略時は`.env`の`EBAY_USER_REFRESH_TOKEN`にフォールバックする（`npm run setup:policies`のローカル手動実行専用）。`index.js`・`setupPolicies.js`から利用 |
| [server/ebayConnectionsRepository.js](server/ebayConnectionsRepository.js) | `ebay_connections`テーブルへの読み書き（`getEbayConnection` / `getEbayRefreshToken` / `setEbayConnection`）。ユーザーごとのrefresh_token・Business Policy ID・出荷元ロケーションキーを一括管理 |
| [server/setupPolicies.js](server/setupPolicies.js) | `ensureBusinessPolicyOptIn` / `ensureFulfillmentPolicy` / `ensureReturnPolicy` / `ensureMerchantLocation`（いずれもget-or-create、re-runしても安全）と、これらをまとめて呼ぶ`setupEbayPoliciesForToken(token)`をexport。`/api/ebay/callback`がユーザーのログイン直後に自動実行する他、`npm run setup:policies`実行時は`main()`が`.env`のトークンを使ってローカル単独動作する（`isDirectRun`判定でimport時に誤動作しないようガード） |
| [server/envFile.js](server/envFile.js) | `.env`の特定キーをその場で書き換える`updateEnvValue()`（`npm run setup:policies`のローカル実行時のみ使用） |
| [server/supabaseClient.js](server/supabaseClient.js) | Supabaseクライアント（`service_role`キー使用）。`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`未設定時は`supabase`が`null`になり、関連機能のみ安全にスキップ（サーバー全体は落ちない） |
| [server/listingsRepository.js](server/listingsRepository.js) | `listings`テーブルへの読み書き。全関数が`userId`を引数に取り、`.eq('user_id', userId)`で自分のデータのみを対象にする（`saveListing` / `getRecentListings` / `getListingByListingId` / `getSalesSummary` / `getAnalytics`） |

### データベース（Supabase）

出品履歴・売上サマリー・分析グラフ・ユーザーごとのeBay接続情報にSupabase Postgres + Storage + Authを使用
（[server/supabaseClient.js](server/supabaseClient.js)、[server/listingsRepository.js](server/listingsRepository.js)、
[server/ebayConnectionsRepository.js](server/ebayConnectionsRepository.js)）。プロジェクト作成後、SQL Editorで以下を実行:

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

-- ユーザーごとのeBay接続情報（アプリ内「eBayでログイン」で取得したrefresh_token・
-- 自動セットアップされたBusiness Policy ID・出荷元ロケーションキー）
create table public.ebay_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  fulfillment_policy_id text,
  return_policy_id text,
  merchant_location_key text,
  updated_at timestamptz not null default now()
);

-- バックエンドはservice_roleキーで常にRLSをバイパスするが、直接アクセス経路を塞ぐため有効化しておく
alter table public.listings enable row level security;
alter table public.ebay_connections enable row level security;
```

さらにStorageに`product-images`という**Public**バケットを作成（撮影画像の公開URL発行に使用）。

**Authentication設定**: 「Authentication」→「Sign In / Providers」→「Email」の「Confirm email」を有効にすると、
サインアップ時に確認メールが必須になる（本番運用推奨）。無効にすると確認メール無しで即ログインできる
（開発・動作確認向け）。

## eBay連携の初回セットアップ手順

`.env`にAPIキーを設定するだけでは出品(`/api/publish-ebay`)は完了しない。以下を一度だけ順番に行う必要がある。

1. eBay Developer Portalでキーセット（`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`）とRuName（`EBAY_RU_NAME`）を作成し、
   RuNameの「Your auth accepted URL」に `http://localhost:3001/api/ebay/callback`（本番は
   `https://<バックエンドの公開URL>/api/ebay/callback`）を設定する
   （eBayが非httpsのlocalhostを許可しない場合はngrok等で公開URLを用意する）。
2. 出荷元住所を`.env`の`EBAY_LOCATION_ADDRESS_LINE1`等に設定しておく（アプリ全体で共有の単一設定）。
3. アプリにログイン（未登録ならアカウント作成）した上で、「設定」タブ →「eBayでログイン」ボタンから、
   eBayの同意画面でログインしたいアカウントにログインしアプリを許可する。**このボタンで同意した
   eBayアカウントで、このアプリユーザーは以後出品されるようになる**。`/api/ebay/callback`が
   Business Policies・出荷元ロケーションの自動セットアップと`refresh_token`等の
   Supabase(`ebay_connections`)への保存まで一括で行うため、`npm run setup:policies`の手動実行や
   バックエンドの再起動は不要。
4. これで `/api/publish-ebay` が実行可能になる。設定タブのeBay連携状態が「接続中」になっていることで確認できる。

## デプロイ

無料サブドメインでのデプロイを想定し、以下の構成・設定ファイルを用意済み（実際のアカウント連携はユーザー操作が必要）。

- **フロントエンド**: Vercel（Viteをゼロコンフィグで自動検出）。GitHubリポジトリと連携してビルドする。
  環境変数 `VITE_BACKEND_URL` に、デプロイ後のRenderバックエンドURLを設定する
  （[src/services/listingService.ts](src/services/listingService.ts)がこれを参照、未設定時は`localhost:3001`）。
  ログイン機能に必要な`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`もVercelの環境変数に設定が必要。
- **バックエンド**: Render（Web Service）。[render.yaml](render.yaml) にBlueprint定義済み。
  `sync: false`の環境変数（[.env.example](.env.example)参照）はRenderダッシュボードで手動入力が必要。
  `PORT`はRenderが自動注入するため設定不要。Renderは永続ディスクが無いため、`.env`書き換え系の値
  （`refresh_token`等）はダッシュボードの環境変数として保存する必要がある点に注意。
- デプロイ後、eBay Developer PortalのRuNameの「Your auth accepted URL」を、実際のRender公開URL
  （例: `https://<render-app>.onrender.com/api/ebay/callback`）に変更する必要がある。

## 環境変数

`.env`はGit管理対象外（`.gitignore`に追記済み）。値は[.env.example](.env.example)を参照しつつ、ユーザー自身が
Google AI Studio/Groq Console/Supabase/eBay Developerで取得して設定する。

| カテゴリ | 変数 |
|---|---|
| サーバー | `PORT` |
| Supabase（バックエンド） | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase（フロントエンド、Vite経由でビルドに埋め込まれる） | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（publishable/anonキー） |
| AI | `AI_PROVIDER` / `GEMINI_API_KEY` / `GEMINI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` |
| eBay 認証 | `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_RU_NAME` / `EBAY_ENV` / `EBAY_USER_REFRESH_TOKEN`（`npm run setup:policies`のローカル手動実行専用フォールバック、通常の出品では未使用） |
| eBay 出品設定 | `EBAY_MERCHANT_LOCATION_KEY`（ユーザーごとの出荷元ロケーションキーの命名に使う既定値） / `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID`（いずれも`npm run setup:policies`ローカル実行専用フォールバック） / `EBAY_PAYMENT_POLICY_ID` |
| 出荷元住所 | `EBAY_LOCATION_ADDRESS_LINE1` / `EBAY_LOCATION_CITY` / `EBAY_LOCATION_STATE_OR_PROVINCE` / `EBAY_LOCATION_POSTAL_CODE` / `EBAY_LOCATION_COUNTRY`（アプリ全体で共有の単一出荷元住所） |

## 仕様書との差異

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) はPython/FastAPIでのバックエンド構築、AIエンジンにOpenAI
GPT-4o Visionを想定していたが、実装はNode.js/Express + Google Gemini（`@google/genai`、Groqへの切替も可能）で
行っている。エンドポイント名・レスポンスのキー命名規則（snake_case）は仕様書に合わせた。

## 未実装・要注意な箇所

- **商品画像**: Supabase Storageで公開URL化される（`uploadProductImage()`）。アップロード失敗時、またはモック
  モードでAI解析自体をスキップした場合は、`blob:` URLにフォールバックし、`/api/publish-ebay`側で
  プレースホルダー画像（`https://via.placeholder.com/500`）に強制差し替える暫定対応が働く。
- **売上実績の追跡なし**: `listings`テーブルの「売却済み(SOLD)」へのステータス更新の仕組みが無いため、全出品は
  ACTIVEのまま記録され続け、`totalRevenue`/`monthlyRevenue`/`soldItemsCount`は常に0。ホームの月次売上バッジ
  （前月比%、`monthlyRevenueChangePercent`）も前月売上が0のため`null`になり非表示のまま。実運用にはeBayからの
  売却通知（Webhook等）を受けてステータスを更新する仕組みの追加が必要。
- **`categoryId`は仮の固定値**（`112529`）。実運用にはTaxonomy API等での適切なカテゴリ判定が必要。
- **AI APIのクォータ**: 画像1枚のアップロードあたり最大4回（基本抽出・商品状態・市場トレンド・競合比較）の
  AI呼び出しが発生するため、無料枠のレート制限に達しやすい。Gemini→Groq切替は`aiProvider.js`参照。
- Sandbox環境での出品テストおよびApplication Growth Check (AGC) 申請（本番の呼び出し上限引き上げ）は未着手。
  これらはeBay Developer Portal上でユーザー自身が行う必要がある。
