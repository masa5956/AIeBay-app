# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定
- 常に日本語で会話する
- コメントも日本語で記述する
- エラーメッセージの説明も日本語で行う
- ドキュメントも日本語で生成する

## プロジェクト概要

eBay向けのAI自動出品ツール。スマートフォン画面を模したReact SPAで、商品写真をアップロードすると
Gemini（Vision）が画像解析を行い、eBayの類似商品価格を調査した上でeBayに出品するまでのウィザードUIを提供する。
詳細な要件・API契約は [PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) を参照。

## よく使うコマンド

```bash
npm run dev       # Vite開発サーバーを起動（フロントエンドのみ）
npm run server    # server/index.js のExpressバックエンドを起動（要 .env、別ターミナルで実行）
npm run build     # tsc（型チェック）→ vite build
npm run preview   # ビルド済みアプリをローカルでプレビュー
npm run lint      # oxlint による静的解析
```

- フロントエンドは `npm run dev` と `npm run server` を両方起動して初めて実際の出品フローが動作する。
- テストフレームワーク／テストスクリプトは未設定（テストは存在しない）。

## アーキテクチャ

- **フロントエンド**: Vite + React 18 + TypeScript + Tailwind CSS。単一ページで、スマホ画面風の枠（`max-w-md`）の中に
  UIをレンダリングする構成。
- **画面状態管理はすべて [App.tsx](src/App.tsx) に集約**されている。
  - `activeTab`（`home` / `analytics` / `settings`）でボトムナビゲーションのタブを切り替え。
  - `isListingMode` が true の間は、`step`（1〜4）で出品ウィザード（撮影 → AI解析結果の補正 → 価格調整 → 最終確認・出品）
    を進行させる。ウィザードの各ステップのJSXはコンポーネント分割されておらず、App.tsx内に直接書かれている。
  - 型定義は [src/types/app.ts](src/types/app.ts)（`TabType`, `RecentListing`, `SalesSummary`）を参照。
- **型定義**: [src/types/listing.ts](src/types/listing.ts) に `ProductData`（`imageUrl`, `title`, `brand`, `model`,
  `categoryName`, `condition`, `aspects`, `description`, `pricing`）と `Condition` 型を定義。
- **APIクライアント層**: [src/services/listingService.ts](src/services/listingService.ts)。
  - `analyzeImageWithAI` / `estimatePrice` / `publishToEbay` : `http://localhost:3001/api` の実バックエンドを呼び出す
    実装。`App.tsx` は現在これらを使用している（`npm run server` でバックエンドを起動していないと失敗する）。
  - `mockAnalyzeImage` / `mockPublishItem` : [src/mock/mockData.ts](src/mock/mockData.ts) のサンプルデータを返す
    モック実装。バックエンドを起動せずにUI単体の動作確認をしたい場合に、`App.tsx` のimportを一時的にこちらへ
    差し替えて使う。
- **バックエンド**: [server/index.js](server/index.js)（Express、`npm run server` で起動、要 `.env`）。
  - `POST /api/analyze-image` : アップロード画像をmulterで受け取り、Gemini（`@google/genai`、既定モデルは
    `gemini-2.5-flash`）にBase64画像を渡してタイトル・ブランド・型番・状態・説明文をJSONで抽出。
  - `POST /api/estimate-price` : `{keywords, condition}` を受け取り、eBay OAuth（Client Credentials）でアプリトークンを
    取得後、Browse APIで類似商品を検索。IQR（四分位範囲）アルゴリズムで外れ値を除去してから
    `{suggested_price, min_price, max_price}`（snake_case）を算出する。
  - `POST /api/publish-ebay` : eBay OAuth（Refresh Token Grant）でユーザートークンを取得し、Sell Inventory API を
    Inventory Item作成 → Offer作成 → Offer公開の3ステップで呼び出して出品を確定する。`EBAY_FULFILLMENT_POLICY_ID` /
    `EBAY_RETURN_POLICY_ID` が未設定の場合はここでエラーを返す（`npm run setup:policies` の実行を促す）。
  - `GET /api/ebay/auth-url` : eBayユーザー同意画面のURLを発行する（初回セットアップ用）。
  - `GET /api/ebay/callback` : 同意後にeBayからリダイレクトされ、認可コードを`refresh_token`に交換して
    `.env`の`EBAY_USER_REFRESH_TOKEN`に自動保存する。
- **[server/ebayAuth.js](server/ebayAuth.js)**: eBay OAuthの共通処理（アプリトークン取得・ユーザートークン取得・
  認可コード交換）を集約。`server/index.js` と `server/setupPolicies.js` の両方から利用する。
- **[server/envFile.js](server/envFile.js)**: `.env`の特定キーをその場で書き換える`updateEnvValue()`を提供。
  取得した`refresh_token`やBusiness Policy IDの保存に使う。
- **[server/setupPolicies.js](server/setupPolicies.js)**（`npm run setup:policies`）: eBayの配送・返品ポリシーと
  出荷元ロケーションを、既存があれば再利用・無ければ最低限の内容で新規作成し、IDを`.env`へ書き戻す一度きりの
  セットアップスクリプト。`EBAY_USER_REFRESH_TOKEN`が既に`.env`にある状態で実行する。

## eBay連携の初回セットアップ手順

`.env`にAPIキーを設定するだけでは出品(`/api/publish-ebay`)は完了しない。以下を一度だけ順番に行う必要がある
（詳しい背景は本チャットのやり取り、または各ファイルのコメント参照）。

1. eBay Developer Portalでキーセット（`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`）とRuName（`EBAY_RU_NAME`）を作成し、
   RuNameの「Your auth accepted URL」に `http://localhost:3001/api/ebay/callback` を設定する
   （eBayが非httpsのlocalhostを許可しない場合はngrok等で公開URLを用意する）。
2. `npm run server` でバックエンドを起動し、ブラウザで `http://localhost:3001/api/ebay/auth-url` を開いて
   得られた`url`にアクセス、eBayアカウントでログインしてアプリを許可する。
3. リダイレクト後、`.env`の`EBAY_USER_REFRESH_TOKEN`が自動保存される。バックエンドを再起動する。
4. `npm run setup:policies` を実行し、配送・返品ポリシーと出荷元ロケーションを作成する
   （出荷元ロケーションを新規作成する場合は`EBAY_LOCATION_ADDRESS_LINE1`等の住所を`.env`に先に設定しておく）。
5. これで `/api/publish-ebay` が実行可能になる。

## 仕様書との差異

[PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) はPython/FastAPIでのバックエンド構築を想定していたが、実装は
既存のNode.js/Express資産（`express`, `multer`, `openai`, `axios` は元々`package.json`の依存関係として存在していた）
を活かす方針でNode.js/Expressのまま、エンドポイント名・レスポンスのキー命名規則（snake_case）のみ仕様書に合わせた。

## 未実装・要注意な箇所

- **商品画像は公開URLになっていない。** フロントエンドは撮影画像を`URL.createObjectURL()`でブラウザ内だけの
  `blob:` URLにしており、これはeBayから取得できない。[server/index.js](server/index.js)の`/api/publish-ebay`は
  `http`で始まらない`imageUrl`をプレースホルダー画像（`https://via.placeholder.com/500`）に強制的に差し替える
  暫定対応をしているため、実際の商品画像は出品されない。実運用には画像を外部ストレージ（Cloudinary/S3等）へ
  アップロードして公開URLを払い出す処理の追加が必要。
- 以下のファイルは中身が空（0バイト）のプレースホルダーで、ウィザードのロジックは実際にはApp.tsxに直書きされている：
  `src/components/StepperHeader.tsx`, `src/components/Step1_ImageUpload.tsx`, `src/components/Step2_MetadataEdit.tsx`,
  `src/components/Step3_Pricing.tsx`, `src/components/Step4_Preview.tsx`。UIをコンポーネント分割する際の受け皿として
  用意されていると思われる。
- ルート直下の [ebay_ai_auto_lister_dashboard.tsx](ebay_ai_auto_lister_dashboard.tsx) は `src/` に含まれておらず
  Viteアプリからは読み込まれない、より作り込まれた単体プロトタイプ（`lucide-react` のアイコンや `recharts` の
  グラフ、`Product`/`Aspect`/`PricingDataPoint` 型、`PRESET_PRODUCTS` モックデータを使用）。分析タブや商品詳細UIを
  拡張する際のデザイン参考として存在すると考えられるが、現行アプリには組み込まれていない。
- `categoryId`は仮の固定値（`112529`）。実運用にはTaxonomy API等での適切なカテゴリ判定が必要。
- `.env` はGit管理対象外（`.gitignore` に追記済み）。バックエンド側で読み込む変数は
  `PORT` / `GEMINI_API_KEY` / `GEMINI_MODEL` / `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_RU_NAME` /
  `EBAY_USER_REFRESH_TOKEN` / `EBAY_ENV` / `EBAY_MERCHANT_LOCATION_KEY` / `EBAY_FULFILLMENT_POLICY_ID` /
  `EBAY_RETURN_POLICY_ID` / `EBAY_PAYMENT_POLICY_ID` / `EBAY_LOCATION_ADDRESS_LINE1` 等の住所4項目。値はユーザー
  自身がGoogle AI Studio/eBay Developerで取得して設定する必要があり、現状は空のプレースホルダー。
- Sandbox環境での出品テストおよび Application Growth Check (AGC) 申請（本番の呼び出し上限引き上げ）は未着手。
  これらはeBay Developer Portal上でユーザー自身が行う必要がある。
