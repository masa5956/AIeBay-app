# eBay AI Auto Lister プロジェクト要件・構成仕様書

> 本ドキュメントはプロジェクト検討時に作成された要件・アーキテクチャ仕様書の原文である。
> 実装はNode.js/Express（[server/index.js](server/index.js)）で行っており、API契約（エンドポイント名・大文字小文字規則）は
> 本仕様書に合わせているが、バックエンド実行環境はPython/FastAPIではなくNode.js/Expressである。
> また、AIエンジンは当初のOpenAI GPT-4o Visionから **Google Gemini**（`@google/genai`、既定モデル
> `gemini-2.5-flash`）に変更している。
> 実装の実態と差異がある箇所は [CLAUDE.md](CLAUDE.md) の「仕様書との差異」を参照。

## 1. プロジェクト概要

* **アプリ名**: eBay AI Auto Lister
* **目的**: スマホで商品の画像（銘板・ラベル・外観）を撮影するだけで、AI（Gemini Vision）による文字・属性情報の自動抽出、eBay上の類似商品価格のリアルタイム調査、SEO最適化タイトル・商品説明の自動作成、およびeBayへの自動出品を完了させるモバイル向けWebアプリケーションの構築。
* **ターゲット端末**: スマートフォン (レスポンシブWeb UI / PWA)

---

## 2. アプリ機能要件

### (1) メイン画面 (ホーム / ダッシュボード)

* **売上ダッシュボード**: 今月の売上合計 ($USD)、アクティブ出品数、累計販売数を表示。
* **メインアクション**: 「写真から出品を作成する」ボタン（タップで出品ウィザードへ遷移）。
* **最近の出品リスト**: 直近に出品・売却された商品の一覧表示（ステータス: `ACTIVE` / `SOLD` / `DRAFT`）。
* **ボトムナビゲーションバー**: 画面下部に「ホーム」「分析」「設定」の固定タブを配置。

### (2) 自動出品プロセス (4ステップ・ウィザード形式)

ユーザーの誤認識やAIのハルシネーション（誤認識）を防ぐため、Human-in-the-Loop（人間の確認ステップ）を挟む構成。

1. **Step 1: 撮影・画像選択**
   * スマホカメラの起動または端末画像ファイル選択。

2. **Step 2: AI解析結果の確認・微修正 (HITL)**
   * AIが画像から抽出した「タイトル(最大80文字)」「ブランド」「型番」「コンディション」を表示・手動編集。

3. **Step 3: 適正価格査定・調整**
   * eBay Browse API経由で取得した同一・類似商品の価格データから算出した「AI推奨出品価格」および「相場範囲（最安値〜最高値）」を表示・手動調整。

4. **Step 4: 出品確認・パブリッシュ**
   * 最終的な出品プレビューを表示し、「eBayに出品する」ボタンでパブリッシュ処理を実行。

### (3) 販売統計・分析機能 (将来実装)

* 過去の利益率、カテゴリ別の売れ筋傾向などをグラフ表示する分析タブ。

---

## 3. システムアーキテクチャ設計

フロントエンドとAI・データ処理用バックエンドを分離し、`POST` リクエストで非同期通信を行う拡張性の高い構成を採用。

```
[ スマホクライアント (Vite + React) ]
       │
       │  ① 画像データ POST (FormData)
       │  ② キーワード/型番 POST (JSON)
       │  ③ 出品リクエスト POST (JSON)
       ▼
[ バックエンド (Node.js / Express) ] ── (環境変数 .env 管理)
       │
       ├─► [ Google Gemini API (Vision) ]  (画像からメタデータ抽出)
       │
       └─► [ eBay REST APIs ]
             ├─ Browse API (リアルタイム市場価格・相場取得)
             └─ Sell Inventory / Offer API (SKU作成・オファー作成・パブリッシュ)
```

---

## 4. 技術スタック

* **フロントエンド**: Vite, React, TypeScript, Tailwind CSS
* **バックエンド**: Node.js, Express, Multer, Axios, dotenv, `@google/genai`
* **AIエンジン**: Google Gemini API (`gemini-2.5-flash` Vision / JSON構造化出力)
* **外部連携**: eBay Developer Program (REST APIs)
  * Authentication: OAuth 2.0 (Client Credentials Grant / Refresh Token Grant)
  * Marketplace: eBay US (`EBAY_US`)

---

## 5. API通信仕様 (バックエンドエンドポイント)

### ① `POST /api/analyze-image` (AI画像解析)

* **入力**: `multipart/form-data` (画像ファイル)
* **処理**: Gemini Visionを呼び出し、構造化JSONでパース。
* **出力 JSON**:
```json
{
  "title": "Sony WH-1000XM5 Wireless Headphones - Black",
  "brand": "Sony",
  "model": "WH-1000XM5",
  "condition": "USED_EXCELLENT",
  "description": "Full functional Sony WH-1000XM5..."
}
```

### ② `POST /api/estimate-price` (市場価格査定)

* **入力 JSON**: `{"keywords": "Sony WH-1000XM5", "condition": "USED_EXCELLENT"}`
* **処理**: eBay Browse APIで類似商品を取得し、四分位範囲 (IQR) アルゴリズムで外れ値を除去して適正価格・最安値・最高値を計算。
* **出力 JSON**:
```json
{
  "suggested_price": 249.99,
  "min_price": 210.00,
  "max_price": 285.00
}
```

### ③ `POST /api/publish-ebay` (eBay自動出品)

* **入力 JSON**: 最終調整された商品メタデータおよび価格情報
* **処理**:
  1. `PUT /sell/inventory/v1/inventory_item/{sku}` (SKU生成・商品登録)
  2. `POST /sell/inventory/v1/offer` (価格・ポリシー紐付け)
  3. `POST /sell/inventory/v1/offer/{offerId}/publish` (出品有効化)
* **出力 JSON**: `{"success": true, "listingId": "EBAY-US-XXXXXXX"}`
* **前提**: `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID`（`npm run setup:policies` で取得）と
  ユーザーOAuth同意による`EBAY_USER_REFRESH_TOKEN`（`GET /api/ebay/auth-url` → `GET /api/ebay/callback`）が必要。

### ④ `GET /api/ebay/auth-url` / `GET /api/ebay/callback` (eBayユーザー同意フロー、初回セットアップ専用)

* eBayのAuthorization Code Grantによるユーザー同意を行い、`EBAY_USER_REFRESH_TOKEN`を取得して`.env`に保存する。
* 詳細な手順は [CLAUDE.md](CLAUDE.md) の「eBay連携の初回セットアップ手順」を参照。

---

## 6. 実装状況

* `src/types/listing.ts`: `ProductData`, `Condition`, `ProductAspect`, `PricingInfo` などのTypeScript型定義。
* `src/types/app.ts`: `TabType`, `RecentListing`, `SalesSummary` などのアプリ全体状態の型定義。
* `src/services/listingService.ts`: バックエンド呼び出し層（実API呼び出し + オフライン確認用モック関数の両方を提供）。
* `src/App.tsx`: モバイルUIレイアウト（ボトムナビゲーション、ダッシュボード、4ステップ出品ウィザード）。
* `server/index.js`: Express製バックエンド（analyze-image / estimate-price / publish-ebay / ebay OAuth の各エンドポイント）。
* `server/ebayAuth.js`: eBay OAuthの共通処理（アプリトークン・ユーザートークン取得、認可コード交換）。
* `server/setupPolicies.js`（`npm run setup:policies`）: Business Policies・出荷元ロケーションの初回セットアップ。

---

## 7. 今後の開発手順・ロードマップ

1. **バックエンド環境の構築** — 完了（`server/index.js`、`npm run server` で起動）。
2. **Gemini API キーおよび eBay Developer アカウントの取得** — `.env` に各キーを設定（値はユーザー自身が用意）。
3. **バックエンド側ロジックの実装** — 完了（Gemini Vision呼び出し、eBay Browse/Inventory API呼び出し）。
4. **フロントエンド通信部の書き換え** — 完了（`listingService.ts` の実API関数を `App.tsx` から呼び出す構成に変更）。
5. **eBayユーザーOAuth同意フロー・Business Policies自動セットアップ** — 完了
   （`GET /api/ebay/auth-url`・`/api/ebay/callback`・`npm run setup:policies`）。
6. **商品画像の公開URLホスティング** — 未着手。現状は`blob:` URLをプレースホルダー画像に差し替える暫定対応のみ。
   Cloudinary/S3等への画像アップロード処理の追加が必要。
7. **Sandbox環境テストおよび Production 移行** — 未着手。ユーザー自身によるeBay Sandboxでのダミー出品テストと、
   Application Growth Check (AGC) 申請提出が必要。
