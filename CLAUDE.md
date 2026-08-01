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
多角的に分析した上でeBayに出品するまでのウィザードUIを提供する。出品履歴・売上サマリー・分析グラフは
Supabase（Postgres + Storage）に永続化される。詳細な要件・API契約は
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
| [HomeDashboard.tsx](src/components/HomeDashboard.tsx) | ホーム。`getListings()`で取得した売上サマリー・最近の出品を表示（マウント時・出品成功後に再取得） |
| [AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx) | 分析。`getAnalytics()`による月別出品額推移・カテゴリ別出品額構成グラフ＋[GenreComparisonPanel.tsx](src/components/GenreComparisonPanel.tsx)（ジャンル比較） |
| [SettingsPanel.tsx](src/components/SettingsPanel.tsx) | 設定。言語切替と、開発者向け「AI解析をモックデータで代用」トグル（ON時は`mockAnalyzeImage`を使いGemini/Groqのクォータを消費しない。出品自体は実APIのまま） |
| [Step1_ImageUpload.tsx](src/components/Step1_ImageUpload.tsx)〜[Step4_Preview.tsx](src/components/Step4_Preview.tsx) | 出品ウィザード（撮影→AI解析結果補正→価格調整→最終確認）。[StepperHeader.tsx](src/components/StepperHeader.tsx)クリックでステップ間移動可（解析結果が無いうちはStep2以降へ移動不可） |
| [Toast.tsx](src/components/Toast.tsx) / [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx) | 完了・失敗通知 / 出品キャンセル確認 |
| [BottomNav.tsx](src/components/BottomNav.tsx) | ホーム/分析/設定のタブ切替 |

- **多言語対応**: [src/i18n/](src/i18n/) に軽量な自前i18n実装（react-i18next等は未使用）。`translations.ts`に日本語/英語辞書、
  `LanguageContext.tsx`の`useLanguage()`（`language`, `setLanguage`, `t()`）を各コンポーネントから呼び出す。選択言語は
  `localStorage`に永続化。**eBayへ実際に送信する出品文（title/description）は英語固定のままで、この切替はアプリUIの
  表示言語のみに影響する。**
- **型定義**: [src/types/listing.ts](src/types/listing.ts)（`ProductData`, `Condition`, AIマルチエージェント分析結果の型）、
  [src/types/app.ts](src/types/app.ts)（`TabType`, `RecentListing`, `SalesSummary`, `AnalyticsData`, `GenreComparisonResult`）。
- **APIクライアント層**: [src/services/listingService.ts](src/services/listingService.ts)。
  `analyzeImageWithAI` / `estimatePrice` / `publishToEbay` / `getListings` / `getAnalytics` / `compareGenres`が
  バックエンド（既定`http://localhost:3001/api`、`VITE_BACKEND_URL`で変更可）を呼び出す実装。
  `mockAnalyzeImage` / `mockPublishItem`（[src/mock/mockData.ts](src/mock/mockData.ts)のサンプルデータ）は
  設定タブのモックトグルやオフライン確認用。

### バックエンド

[server/index.js](server/index.js)（Express、`npm run server`で起動、要`.env`）が公開するエンドポイント:

| Method / Path | 概要 |
|---|---|
| `POST /api/analyze-image` | 画像を`aiProvider.js`経由でGemini/Groqに渡しタイトル・ブランド・型番・状態・説明文・商品仕様(aspects)をJSON抽出。商品状態エージェント（`runConditionAgent`）とSupabase Storageへの画像アップロード（`uploadProductImage`）を`Promise.all`で並列実行 |
| `POST /api/estimate-price` | eBay Browse APIで類似商品検索→IQRで外れ値除去した価格統計＋市場トレンド/競合比較エージェント＋決定的な総合判定スコア（`scoreListing`）を算出 |
| `POST /api/publish-ebay` | Sell Inventory API（Inventory Item→Offer→Publish）で出品確定。必須Item Specifics（Brand/Color/Connectivity/Model/Type、フォールバックの`categoryId=112529`が要求）を既定値で補完。成功後`saveListing()`でSupabaseに履歴保存 |
| `GET /api/listings` | Supabaseの`listings`から最近の出品一覧・売上サマリーを取得（ホーム画面用） |
| `GET /api/analytics` | 月別出品額推移（直近6ヶ月）・カテゴリ別出品額構成を集計（分析タブ用） |
| `POST /api/genre-comparison` | `{genres: string[]}`（2〜6件）についてeBay Browse APIの出品件数・価格帯からLLM不使用の決定的な需要スコアを算出・比較 |
| `GET /api/ebay/auth-url` / `GET /api/ebay/callback` | eBayユーザー同意フロー（初回セットアップ用） |

**主要な既知の制約**（詳細は[未実装・要注意な箇所](#未実装要注意な箇所)を参照）:
- 市場トレンド分析・ジャンル比較は、eBay Browse APIの「現在アクティブな出品」のみに基づく需要推定であり、
  実際の売却実績データではない（Marketplace Insights APIは個別承認制のため未使用）。
- 総合判定スコアはAI解析直後の一時点のスナップショットで、価格を後から調整してもリアルタイム再計算はしない。

#### バックエンドモジュール

| ファイル | 役割 |
|---|---|
| [server/aiProvider.js](server/aiProvider.js) | `.env`の`AI_PROVIDER`（`gemini`/`groq`）で[geminiClient.js](server/geminiClient.js)/[groqClient.js](server/groqClient.js)を切替える共通レイヤー。`generateJson()` / `generateImageJson()`を公開し、`index.js`・`analysisAgents.js`はこれ経由でのみAIを呼ぶ（Geminiのレート制限時はサーバー再起動だけでGroqに切替可能） |
| [server/geminiClient.js](server/geminiClient.js) | Geminiクライアント（`GoogleGenAI`）と`GEMINI_MODEL`定数 |
| [server/groqClient.js](server/groqClient.js) | Groqクライアント（`groq-sdk`）と`GROQ_MODEL`定数（既定`meta-llama/llama-4-scout-17b-16e-instruct`）。画像入力時は`response_format`を指定せず`parseJsonLoose()`で緩くJSON抽出 |
| [server/analysisAgents.js](server/analysisAgents.js) | `runConditionAgent`（商品状態・欠陥検出）、`runMarketTrendAgent` / `runCompetitorAgent`（市場トレンド・競合比較）、`scoreListing`（LLM不使用の決定的な重み付け計算による総合スコア） |
| [server/priceStats.js](server/priceStats.js) | IQR外れ値除去`removeOutliersByIQR()`。`estimate-price`と`genre-comparison`で共有 |
| [server/genreComparison.js](server/genreComparison.js) | `compareGenres()`。複数ジャンルの出品件数・価格帯から需要スコアを算出（LLM不使用） |
| [server/ebayAuth.js](server/ebayAuth.js) | eBay OAuth共通処理（アプリ/ユーザートークン取得、認可コード交換）。`index.js`・`setupPolicies.js`から利用 |
| [server/envFile.js](server/envFile.js) | `.env`の特定キーをその場で書き換える`updateEnvValue()` |
| [server/setupPolicies.js](server/setupPolicies.js) | （`npm run setup:policies`）配送・返品ポリシーと出荷元ロケーションの初回セットアップ。`ensureBusinessPolicyOptIn()`で事前にBusiness Policy機能へオプトイン（新規Sandboxユーザーはデフォルト無効なため） |
| [server/supabaseClient.js](server/supabaseClient.js) | Supabaseクライアント（`service_role`キー使用）。`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`未設定時は`supabase`が`null`になり、関連機能のみ安全にスキップ（サーバー全体は落ちない） |
| [server/listingsRepository.js](server/listingsRepository.js) | `listings`テーブルへの読み書き（`saveListing` / `getRecentListings` / `getSalesSummary` / `getAnalytics`） |

### データベース（Supabase）

出品履歴・売上サマリー・分析グラフ用にSupabase Postgres + Storageを使用（[server/supabaseClient.js](server/supabaseClient.js)、
[server/listingsRepository.js](server/listingsRepository.js)）。プロジェクト作成後、SQL Editorで以下を実行:

```sql
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  listing_id text not null,
  title text not null,
  price numeric not null,
  status text not null default 'ACTIVE',
  image_url text,
  category text not null default 'Other',
  created_at timestamptz not null default now()
);
```

さらにStorageに`product-images`という**Public**バケットを作成（撮影画像の公開URL発行に使用）。

## eBay連携の初回セットアップ手順

`.env`にAPIキーを設定するだけでは出品(`/api/publish-ebay`)は完了しない。以下を一度だけ順番に行う必要がある。

1. eBay Developer Portalでキーセット（`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`）とRuName（`EBAY_RU_NAME`）を作成し、
   RuNameの「Your auth accepted URL」に `http://localhost:3001/api/ebay/callback` を設定する
   （eBayが非httpsのlocalhostを許可しない場合はngrok等で公開URLを用意する）。
2. `npm run server` でバックエンドを起動し、ブラウザで `http://localhost:3001/api/ebay/auth-url` を開いて
   得られた`url`にアクセス、eBayアカウントでログインしてアプリを許可する。
3. リダイレクト後、`.env`の`EBAY_USER_REFRESH_TOKEN`が自動保存される。バックエンドを再起動する。
4. `npm run setup:policies` を実行し、配送・返品ポリシーと出荷元ロケーションを作成する
   （出荷元ロケーションを新規作成する場合は`EBAY_LOCATION_ADDRESS_LINE1`等の住所を`.env`に先に設定しておく）。
5. これで `/api/publish-ebay` が実行可能になる。

## デプロイ

無料サブドメインでのデプロイを想定し、以下の構成・設定ファイルを用意済み（実際のアカウント連携はユーザー操作が必要）。

- **フロントエンド**: Vercel（Viteをゼロコンフィグで自動検出）。GitHubリポジトリと連携してビルドする。
  環境変数 `VITE_BACKEND_URL` に、デプロイ後のRenderバックエンドURLを設定する
  （[src/services/listingService.ts](src/services/listingService.ts)がこれを参照、未設定時は`localhost:3001`）。
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
| Supabase | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| AI | `AI_PROVIDER` / `GEMINI_API_KEY` / `GEMINI_MODEL` / `GROQ_API_KEY` / `GROQ_MODEL` |
| eBay 認証 | `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_RU_NAME` / `EBAY_USER_REFRESH_TOKEN` / `EBAY_ENV` |
| eBay 出品設定 | `EBAY_MERCHANT_LOCATION_KEY` / `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID` / `EBAY_PAYMENT_POLICY_ID` |
| 出荷元住所 | `EBAY_LOCATION_ADDRESS_LINE1` / `EBAY_LOCATION_CITY` / `EBAY_LOCATION_STATE_OR_PROVINCE` / `EBAY_LOCATION_POSTAL_CODE` / `EBAY_LOCATION_COUNTRY` |

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
