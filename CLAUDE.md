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
多角的に分析した上でeBayに出品するまでのウィザードUIを提供する。詳細な要件・API契約は
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

- Vite + React 18 + TypeScript + Tailwind CSS + `lucide-react`（アイコン） + `recharts`（グラフ）。
- **[App.tsx](src/App.tsx) は状態管理と画面組み立てのみを行う薄いシェル**で、各画面のJSXは
  [src/components/](src/components/) 以下のコンポーネントに分割されている。
  - `activeTab`（`home` / `analytics` / `settings`）でボトムナビゲーションのタブを切り替え（[BottomNav.tsx](src/components/BottomNav.tsx)）。
  - `isListingMode` が true の間は、`step`（1〜4）で出品ウィザードを進行させる：
    [Step1_ImageUpload.tsx](src/components/Step1_ImageUpload.tsx)（撮影）→
    [Step2_MetadataEdit.tsx](src/components/Step2_MetadataEdit.tsx)（AI解析結果の補正・商品状態評価の表示）→
    [Step3_Pricing.tsx](src/components/Step3_Pricing.tsx)（価格調整・市場トレンド/競合比較/総合スコアの表示）→
    [Step4_Preview.tsx](src/components/Step4_Preview.tsx)（最終確認・出品）。
    ステップ間の移動は [StepperHeader.tsx](src/components/StepperHeader.tsx) のクリックでも可能（解析結果が
    無いうちはStep2以降へ移動不可）。
  - ホーム（[HomeDashboard.tsx](src/components/HomeDashboard.tsx)、`App.tsx`がマウント時に`getListings()`で
    バックエンド/Supabaseから取得した売上サマリー・最近の出品を表示。出品成功時は`refreshListings()`で再取得）、
    分析（[AnalyticsPanel.tsx](src/components/AnalyticsPanel.tsx)、rechartsによる売上推移・カテゴリ別グラフ。
    現状はダミーデータ）、設定（[SettingsPanel.tsx](src/components/SettingsPanel.tsx)、言語切替スイッチと、
    開発者向けの「AI解析をモックデータで代用」トグルを含む。ONの間は`analyzeImageWithAI`の代わりに
    `mockAnalyzeImage`を使い、Gemini/Groqのクォータを消費せずに出品(`publishToEbay`は実API)を繰り返し検証できる）。
  - 完了・失敗通知は [Toast.tsx](src/components/Toast.tsx)、出品キャンセル確認は
    [CancelConfirmDialog.tsx](src/components/CancelConfirmDialog.tsx)。
  - 型定義は [src/types/app.ts](src/types/app.ts)（`TabType`, `RecentListing`, `SalesSummary`）を参照。
- **多言語対応**: [src/i18n/](src/i18n/) に軽量な自前i18nを実装（react-i18next等は未使用）。
  `translations.ts` に日本語/英語の辞書、`LanguageContext.tsx` の `useLanguage()`（`language`, `setLanguage`, `t()`）
  を各コンポーネントから呼び出す。選択言語は`localStorage`に永続化。**eBayへ実際に送信する出品文（title/description）
  は英語固定のままで、この切替はアプリUIの表示言語のみに影響する。**
- **型定義**: [src/types/listing.ts](src/types/listing.ts) に `ProductData`（`imageUrl`, `title`, `brand`, `model`,
  `categoryName`, `condition`, `aspects`, `description`, `pricing`, `analysis`）と `Condition` 型、および
  AIマルチエージェント分析結果の型（`ConditionAssessment`, `MarketTrend`, `CompetitorSuggestions`, `ListingAnalysis`）
  を定義。
- **APIクライアント層**: [src/services/listingService.ts](src/services/listingService.ts)。
  - `analyzeImageWithAI` / `estimatePrice` / `publishToEbay` / `getListings` : バックエンド（既定は
    `http://localhost:3001/api`、`VITE_BACKEND_URL`環境変数で変更可）を呼び出す実装。`App.tsx`は現在これらを使用。
  - `mockAnalyzeImage` / `mockPublishItem` : [src/mock/mockData.ts](src/mock/mockData.ts) のサンプルデータを返す
    モック実装。設定タブの「AI解析をモックデータで代用」トグルON時に`mockAnalyzeImage`が使われる
    （バックエンドを起動せずにUI単体の動作確認をしたい場合は`mockPublishItem`へも差し替え可能）。

### バックエンド

- [server/index.js](server/index.js)（Express、`npm run server` で起動、要 `.env`）。
  - `POST /api/analyze-image` : アップロード画像をmulterで受け取り、`aiProvider.js`経由でGemini/Groqの
    どちらか（`AI_PROVIDER`で選択）にBase64画像を渡してタイトル・ブランド・型番・状態・説明文・商品仕様(aspects)を
    JSONで抽出。
    基本抽出エージェントと[商品状態エージェント](server/analysisAgents.js)（`runConditionAgent`）、および
    画像をSupabase Storageへアップロードして公開URLを発行する`uploadProductImage()`を`Promise.all`で並列実行し、
    `conditionAssessment`と`imageUrl`（公開URL、アップロード失敗時は`null`）をレスポンスに含める。
  - `POST /api/estimate-price` : `{keywords, condition, productDraft, conditionAssessment}` を受け取り、eBay OAuth
    （Client Credentials）でアプリトークンを取得後、Browse APIで類似商品を検索。IQR（四分位範囲）アルゴリズムで
    外れ値を除去してから価格を算出しつつ、[市場トレンドエージェント](server/analysisAgents.js)（`runMarketTrendAgent`）
    と[競合比較エージェント](server/analysisAgents.js)（`runCompetitorAgent`）を並列実行し、決定的な計算のみで
    高速に算出する[総合判定スコア](server/analysisAgents.js)（`scoreListing`、LLM呼び出しではない）とあわせて
    `{suggested_price, min_price, max_price, market_trend, competitor_suggestions, overall_score, recommendation}`
    （snake_case）を返す。
  - `POST /api/publish-ebay` : eBay OAuth（Refresh Token Grant）でユーザートークンを取得し、Sell Inventory API を
    Inventory Item作成 → Offer作成 → Offer公開の3ステップで呼び出して出品を確定する。Step2で確認・編集された
    `aspects`配列全体をeBayの商品仕様として送信する（フォールバックの`categoryId=112529`が必須とする
    Brand/Color/Connectivity/Model/Typeが欠けている場合は既定値で補完）。`EBAY_FULFILLMENT_POLICY_ID` /
    `EBAY_RETURN_POLICY_ID` が未設定の場合はここでエラーを返す（`npm run setup:policies` の実行を促す）。
    出品成功後、[server/listingsRepository.js](server/listingsRepository.js)の`saveListing()`でSupabaseの
    `listings`テーブルに出品履歴を保存する（保存失敗は出品自体の成否には影響させずログのみ出力）。
  - `GET /api/listings` : Supabaseの`listings`テーブルから最近の出品一覧（新しい順）と売上サマリーを取得して返す。
    ホーム画面のダッシュボード表示に使用（`App.tsx`がマウント時と出品成功後に呼び出す）。
  - `GET /api/ebay/auth-url` : eBayユーザー同意画面のURLを発行する（初回セットアップ用）。
  - `GET /api/ebay/callback` : 同意後にeBayからリダイレクトされ、認可コードを`refresh_token`に交換して
    `.env`の`EBAY_USER_REFRESH_TOKEN`に自動保存する。
- **[server/aiProvider.js](server/aiProvider.js)**: AIエンジンの切替レイヤー。`.env`の`AI_PROVIDER`
  （`gemini` または `groq`、未設定時は`gemini`）を見て、[server/geminiClient.js](server/geminiClient.js)と
  [server/groqClient.js](server/groqClient.js)のどちらかを選択し、共通インターフェース
  `generateJson(promptText)` / `generateImageJson(promptText, base64Image, mimeType)` として公開する。
  `server/index.js`・`server/analysisAgents.js`はどちらも`aiProvider.js`経由でのみAIを呼び出すため、
  `.env`の`AI_PROVIDER`を書き換えてサーバーを再起動するだけでGemini⇔Groqを切替できる
  （例: Geminiの無料枠レート制限に達した場合の一時的な切替に使う）。
- **[server/geminiClient.js](server/geminiClient.js)**: Geminiクライアント（`GoogleGenAI`）と`GEMINI_MODEL`定数を
  集約。`dotenv.config()`を自身でも呼び出しており、importの評価順序に依存しない。
- **[server/groqClient.js](server/groqClient.js)**: Groqクライアント（`groq-sdk`）と`GROQ_MODEL`定数
  （既定は`meta-llama/llama-4-scout-17b-16e-instruct`、マルチモーダル対応モデル）を集約。テキスト応答に
  Markdownのコードフェンスや前置きが混ざる場合に備え、`parseJsonLoose()`で緩くJSON部分を抽出する。
  画像+テキストの呼び出しでは`response_format: json_object`を指定しない（画像入力との組み合わせが
  非対応のモデルがあるため）、プロンプト内指示＋緩いパースでJSON化する点がGemini版との実装差異。
- **[server/analysisAgents.js](server/analysisAgents.js)**: AIマルチエージェント分析の実体。
  `runConditionAgent`（画像ベースの商品状態・欠陥検出）、`runMarketTrendAgent` / `runCompetitorAgent`
  （テキストベースの市場トレンド・競合比較、eBay Browse APIの検索結果を渡す）、`scoreListing`（LLM呼び出しではない
  決定的な重み付け計算による総合判定スコア）を提供。各エージェントは呼び出し元で`Promise.all`により並列実行され、
  レスポンス速度を確保している。**市場トレンド分析はeBay Browse APIの「現在アクティブな出品」のみに基づく需要推定
  であり、実際の売却実績データではない**（Marketplace Insights API等へのアクセス権が無いため）。
- **[server/ebayAuth.js](server/ebayAuth.js)**: eBay OAuthの共通処理（アプリトークン取得・ユーザートークン取得・
  認可コード交換）を集約。`server/index.js` と `server/setupPolicies.js` の両方から利用する。
- **[server/envFile.js](server/envFile.js)**: `.env`の特定キーをその場で書き換える`updateEnvValue()`を提供。
  取得した`refresh_token`やBusiness Policy IDの保存に使う。
- **[server/setupPolicies.js](server/setupPolicies.js)**（`npm run setup:policies`）: eBayの配送・返品ポリシーと
  出荷元ロケーションを、既存があれば再利用・無ければ最低限の内容で新規作成し、IDを`.env`へ書き戻す一度きりの
  セットアップスクリプト。`EBAY_USER_REFRESH_TOKEN`が既に`.env`にある状態で実行する。実行前にeBay側の
  「Business Policy (Selling Policy Management)」機能へのオプトインが必要なため、`ensureBusinessPolicyOptIn()`で
  自動的にオプトインしてからポリシーを作成する（新規Sandboxテストユーザーはデフォルトで無効なため）。
- **[server/supabaseClient.js](server/supabaseClient.js)**: Supabaseクライアント（`@supabase/supabase-js`、
  `SUPABASE_SERVICE_ROLE_KEY`を使うバックエンド専用の管理者権限クライアント）と、商品画像用ストレージ
  バケット名`PRODUCT_IMAGES_BUCKET`（`'product-images'`）を集約。
- **[server/listingsRepository.js](server/listingsRepository.js)**: Supabase Postgresの`listings`テーブルへの
  読み書きを集約。`saveListing()`（出品成功時の1件保存）、`getRecentListings()`（新しい順取得）、
  `getSalesSummary()`（売上サマリー集計。**現状「売却済み(SOLD)」へのステータス更新の仕組みが無いため、
  全出品はACTIVEのまま記録され続け、totalRevenue/monthlyRevenue/soldItemsCountは常に0になる**）を提供。
  テーブルスキーマは`.env.example`のコメントまたはSupabaseのSQL Editorで以下を実行して作成する:
  ```sql
  create table public.listings (
    id uuid primary key default gen_random_uuid(),
    sku text not null,
    listing_id text not null,
    title text not null,
    price numeric not null,
    status text not null default 'ACTIVE',
    image_url text,
    created_at timestamptz not null default now()
  );
  ```
  加えてStorageに`product-images`という**Public**バケットの作成が必要（`server/index.js`の
  `uploadProductImage()`がここへ画像をアップロードし、`getPublicUrl()`で公開URLを発行する）。

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
  `sync: false`の環境変数（`GEMINI_API_KEY`等、[.env.example](.env.example)参照）はRenderダッシュボードで
  手動入力が必要。`PORT`はRenderが自動注入するため設定不要。
- デプロイ後、eBay Developer PortalのRuNameの「Your auth accepted URL」を、実際のRender公開URL
  （例: `https://<render-app>.onrender.com/api/ebay/callback`）に変更する必要がある。

## 仕様書との差異

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) はPython/FastAPIでのバックエンド構築、AIエンジンにOpenAI
GPT-4o Visionを想定していたが、実装はNode.js/Express + Google Gemini（`@google/genai`）で行っている。
エンドポイント名・レスポンスのキー命名規則（snake_case）は仕様書に合わせた。

## 未実装・要注意な箇所

- **商品画像はSupabase Storageで公開URL化される。** `/api/analyze-image`が受け取った画像をSupabase Storageの
  `product-images`バケットへアップロードし、発行された公開URLを`imageUrl`としてレスポンスに含める
  （[server/index.js](server/index.js)の`uploadProductImage()`）。アップロードに失敗した場合、または
  設定タブのモックモードでAI解析自体をスキップした場合は、フロントエンドが`blob:` URLにフォールバックし、
  `/api/publish-ebay`側で`http`で始まらない`imageUrl`をプレースホルダー画像
  （`https://via.placeholder.com/500`）に強制的に差し替える暫定対応が引き続き働く。
- 「最近の出品・売上サマリー」はSupabase Postgresの`listings`テーブルに永続化されるが、**売却済み(SOLD)への
  ステータス更新の仕組みが無い**ため、売上金額(`totalRevenue`/`monthlyRevenue`)と`soldItemsCount`は常に0。
  実運用にはeBayからの売却通知（Webhook等）を受けてステータスを更新する仕組みの追加が必要。
- `categoryId`は仮の固定値（`112529`）。実運用にはTaxonomy API等での適切なカテゴリ判定が必要。
- AIマルチエージェント分析（特に商品状態評価）を追加したことで、画像1枚のアップロードあたりのAI API呼び出し回数が
  従来の1回から最大4回（基本抽出・商品状態・市場トレンド・競合比較）に増えている。無料枠のレート制限
  （例: 1日あたりのリクエスト数上限）に達しやすい点に注意。Geminiのレート制限に達した場合は、`.env`の
  `AI_PROVIDER`を`"groq"`に変更しサーバーを再起動することでGroq（`meta-llama/llama-4-scout-17b-16e-instruct`）に
  切替可能（[server/aiProvider.js](server/aiProvider.js)参照）。
- Step3の総合判定スコアはAI解析直後の一時点のスナップショットであり、価格をその後手動調整してもリアルタイムには
  再計算されない（毎回バックエンド呼び出しが増えるコストとのトレードオフとして意図的に単純化している）。
- `.env` はGit管理対象外（`.gitignore` に追記済み）。バックエンド側で読み込む変数は
  `PORT` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `AI_PROVIDER` / `GEMINI_API_KEY` / `GEMINI_MODEL` /
  `GROQ_API_KEY` / `GROQ_MODEL` / `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_RU_NAME` /
  `EBAY_USER_REFRESH_TOKEN` / `EBAY_ENV` / `EBAY_MERCHANT_LOCATION_KEY` / `EBAY_FULFILLMENT_POLICY_ID` /
  `EBAY_RETURN_POLICY_ID` / `EBAY_PAYMENT_POLICY_ID` / `EBAY_LOCATION_ADDRESS_LINE1` 等の住所4項目
  （[.env.example](.env.example)参照）。値はユーザー自身がGoogle AI Studio/Groq Console/Supabase/eBay Developerで
  取得して設定する必要がある。
- Sandbox環境での出品テストおよび Application Growth Check (AGC) 申請（本番の呼び出し上限引き上げ）は未着手。
  これらはeBay Developer Portal上でユーザー自身が行う必要がある。
