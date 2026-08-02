import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import axios from 'axios';
import crypto from 'node:crypto';
import {
  EBAY_ENVIRONMENTS,
  AUTH_SCOPES,
  getEbayEnvConfig,
  getAppAccessToken,
  getUserAccessToken,
  exchangeAuthCodeForTokens,
  getEbayUsername,
} from './ebayAuth.js';
import {
  getEbayConnection,
  getAllEbayConnections,
  setEbayConnection,
  deleteEbayConnectionsByUsername,
} from './ebayConnectionsRepository.js';
import { getActiveEbayEnv, setActiveEbayEnv } from './userSettingsRepository.js';
import { setupEbayPoliciesForToken } from './setupPolicies.js';
import { requireAuth } from './authMiddleware.js';
import { AI_PROVIDER, generateImageJson } from './aiProvider.js';
import { runConditionAgent, runMarketTrendAgent, runCompetitorAgent, scoreListing } from './analysisAgents.js';
import { supabase, PRODUCT_IMAGES_BUCKET } from './supabaseClient.js';
import { saveListing, getRecentListings, getSalesSummary, getAnalytics, getListingByListingId } from './listingsRepository.js';
import { removeOutliersByIQR } from './priceStats.js';
import { createOAuthState, consumeOAuthState } from './oauthStateStore.js';
import { verifyEbayNotificationSignature } from './ebayNotificationVerifier.js';

dotenv.config();

const app = express();

// フロントエンドの実オリジンのみ許可する（未指定だと任意サイトからのCORSリクエストを許してしまうため）。
// Vercelはブランチ・プレビューごとに別URL（https://a-ie-bay-app-git-<branch>-<team>.vercel.app等）を
// 自動生成し事前に固定できないため、このプロジェクト名で始まる*.vercel.appドメインは正規表現で
// まとめて許可する。ALLOWED_ORIGINSでカンマ区切りの追加オリジン（カスタムドメイン等）も指定可能。
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'https://a-ie-bay-app.vercel.app'];
const VERCEL_PREVIEW_ORIGIN_PATTERN = /^https:\/\/a-ie-bay-app[a-z0-9-]*\.vercel\.app$/;
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extraAllowedOrigins]);

app.use(cors({
  origin(origin, callback) {
    // Origin未指定のリクエスト（eBayからのサーバー間呼び出しやOAuthのブラウザ遷移等）はCORSの対象外なので許可する。
    // ブラウザのfetch/XHRが送るOriginヘッダーのみを許可リストと照合する。
    if (!origin || allowedOrigins.has(origin) || VERCEL_PREVIEW_ORIGIN_PATTERN.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORSポリシーにより許可されていないオリジンです'));
  },
}));
app.use(express.json());

// HTMLに埋め込む文字列をエスケープする（反射型XSS対策）
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// 画像アップロードのメモリ保持設定。サイズ上限とMIMEタイプ検証でDoS・不正ファイルを防ぐ
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('画像ファイルのみアップロードできます。'));
  },
});

// 撮影画像をSupabase Storageにアップロードし、eBayが取得可能な公開URLを発行する。
// 失敗してもAI解析自体は継続させ、呼び出し元でnullをフォールバック処理させる。
async function uploadProductImage(buffer, mimetype) {
  if (!supabase) return null; // Supabase未設定時はアップロードをスキップ

  const ext = (mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const filePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(filePath, buffer, { contentType: mimetype });

  if (error) {
    console.error('Supabase画像アップロードエラー:', error);
    return null;
  }

  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

// アプリ内部で使う簡易4段階の商品状態評価(AIの判定・UI表示用)と、eBayの実際のConditionEnum文字列・
// 数値conditionIdとの対応表。"USED_FAIR"はeBayの正式なConditionEnum値ではなく本アプリ独自の
// 簡易名称のため、eBayに送信する際は必ずこの表でENUM名・数値IDに変換してから使う
// （数値IDはeBay Sell Metadata API `get_item_condition_policies` のレスポンスで確認済み）。
const CONDITION_INFO = {
  NEW: { enum: 'NEW', id: '1000' },
  USED_EXCELLENT: { enum: 'USED_EXCELLENT', id: '3000' },
  USED_GOOD: { enum: 'USED_GOOD', id: '5000' },
  USED_FAIR: { enum: 'USED_ACCEPTABLE', id: '6000' },
};
// カテゴリが上記4つのいずれも許可していない場合の最終フォールバック候補（実在するeBay ConditionEnum）
const FALLBACK_CONDITION_CANDIDATES = [
  { key: 'USED_EXCELLENT', enum: 'USED_EXCELLENT', id: '3000' },
  { key: 'NEW', enum: 'NEW', id: '1000' },
  { key: 'USED_GOOD', enum: 'USED_GOOD', id: '5000' },
  { key: 'USED_FAIR', enum: 'USED_ACCEPTABLE', id: '6000' },
  { key: 'FOR_PARTS', enum: 'FOR_PARTS_OR_NOT_WORKING', id: '7000' },
];


// =================================================================
// 1. AI画像解析エンドポイント (/api/analyze-image)
// =================================================================
const EBAY_ANALYSIS_PROMPT = `この商品画像を分析し、eBay出品用の情報をJSONフォーマットのみで出力してください（説明や前置きは不要）。
実際のeBay出品ページの「Item Specifics（商品仕様）」欄を参考に、写っている商品のカテゴリから推測できる
具体的な仕様項目をできるだけ多く含めてください。ブランドやモデルが商品自体から読み取れない場合は
"Unbranded" / "Does not apply" を使ってください。
複数枚の画像が提供されている場合は、同一商品を異なる角度・部位から撮影したものです。全ての画像を
総合して1つの商品情報（1つのtitle・description・aspects）にまとめてください（画像ごとに別々の結果を
出力しないこと）。ラベルや型番の刻印が一部の画像にしか写っていない場合は、その画像から読み取った情報も
反映してください。

出力フォーマット:
{
  "title": "eBayでよく検索される単語を含む80文字以内の英語SEOタイトル",
  "brand": "ブランド名",
  "model": "型番",
  "condition": "NEW、USED_EXCELLENT、USED_GOOD、USED_FAIRのいずれか",
  "description": "英語の長文商品説明（200〜300語程度、改行区切りで以下4段落構成）。1段落目: 商品の概要（何の商品か、ブランド・用途、検索されやすいキーワードを自然に含める）。2段落目: 主な仕様・特徴（画像から判断できる仕様をできるだけ具体的に列挙する形で記述）。3段落目: 商品の状態（傷・汚れ・使用感・動作確認状況など、画像から読み取れる状態を具体的かつ正直に記述。誇張しない）。4段落目: 付属品・同梱物（分かれば記載、無ければこの段落は省略）。",
  "aspects": {
    "Type": "商品の種類",
    "Color": "色",
    "Material": "素材",
    "Size": "サイズ（判別できれば、できなければ省略）",
    "Department": "対象（Unisex/Men/Women/Kidsなど、該当すれば）",
    "Country/Region of Manufacture": "製造国（パッケージ等から読み取れれば）",
    "Connectivity": "接続方式（Bluetooth/Wired/Wi-Fiなど、該当すれば。無ければ Does not apply）",
    "MPN": "型番が無ければ Does not apply",
    "UPC": "バーコードが読めなければ Does not apply",
    "Features": "特徴をカンマ区切りで",
    "Included Items": "付属品・同梱物をカンマ区切りで（分からなければ省略）"
  }
}

"aspects"は上記をベースに、写っている商品カテゴリに応じて適切な項目を追加・省略してよい
（例: 家電なら「Power Source」「Connectivity」、衣類なら「Style」「Pattern」など）。
値が不明な項目はキーごと省略してください。`;

// MAX_ANALYZE_IMAGESより多い枚数を送ると、multerが「Unexpected field」ではなく
// LIMIT_UNEXPECTED_FILEエラーを返す（末尾のエラーハンドラーでJSON化される）
const MAX_ANALYZE_IMAGES = 8;

app.post('/api/analyze-image', requireAuth, upload.array('images', MAX_ANALYZE_IMAGES), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '画像ファイルが添付されていません。' });
    }

    // 複数枚を1回のAI呼び出しでまとめて解析できるよう、base64配列に変換
    const images = req.files.map((file) => ({
      base64Image: file.buffer.toString('base64'),
      mimeType: file.mimetype,
    }));

    // 基本情報抽出・商品状態エージェント・Supabaseへの画像アップロード(全枚数分)を並列実行
    const [parsedContent, conditionAssessment, imageUrls] = await Promise.all([
      generateImageJson(EBAY_ANALYSIS_PROMPT, images),
      runConditionAgent(images),
      Promise.all(req.files.map((file) => uploadProductImage(file.buffer, file.mimetype))),
    ]);

    return res.json({ ...parsedContent, conditionAssessment, imageUrls });
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return res.status(500).json({ error: 'AI解析に失敗しました。' });
  }
});

// =================================================================
// 2. eBay 類似価格調査エンドポイント (/api/estimate-price)
// =================================================================
app.post('/api/estimate-price', requireAuth, async (req, res) => {
  try {
    const { keywords, condition, productDraft, conditionAssessment } = req.body;
    if (!keywords) {
      return res.status(400).json({ error: '検索キーワードが必要です。' });
    }

    // 価格調査(Browse API)は出品先環境(Sandbox/Production)とは切り離し、常に本番の実在庫データを使う。
    // SandboxのBrowse APIはテスト用のごく僅かなダミーデータしか無く、実商品名で検索しても
    // ほぼ確実に0件になり価格が常に$0になってしまうため。Browse APIはユーザー認可不要の
    // app tokenで読み取るだけなので、出品先環境と異なっていても問題ない。
    // Production未設定（EBAY_PRODUCTION_CLIENT_ID等が空）の場合のみ、現在の出品先環境で代用する。
    const productionConfig = getEbayEnvConfig('PRODUCTION');
    const priceResearchEnv = (productionConfig.clientId && productionConfig.clientSecret)
      ? 'PRODUCTION'
      : await getActiveEbayEnv(req.userId);
    const { baseUrl } = getEbayEnvConfig(priceResearchEnv);
    const appToken = await getAppAccessToken(priceResearchEnv);

    // Browse API による同一・類似商品の価格検索
    const searchResponse = await axios.get(
      `${baseUrl}/buy/browse/v1/item_summary/search`,
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        params: {
          q: keywords,
          limit: 50,
          filter: condition && CONDITION_INFO[condition]
            ? `buyingOptions:{FIXED_PRICE},conditionIds:{${CONDITION_INFO[condition].id}}`
            : 'buyingOptions:{FIXED_PRICE}',
        },
      }
    );

    const items = searchResponse.data.itemSummaries || [];
    const prices = items
      .map((item) => parseFloat(item.price?.value || '0'))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);

    // 類似商品が1件も見つからない場合でも価格を0にするだけで、市場トレンド・競合比較・
    // 総合スコアの計算自体は必ず行う（以前はここで即returnしていたため、ブランド・型番を
    // AIが読み取れず検索語が"Unbranded Does not apply"のようになった場合に分析全体が
    // 空になってしまっていた）。
    let min_price = 0;
    let max_price = 0;
    let suggested_price = 0;
    if (prices.length > 0) {
      // IQRアルゴリズムで外れ値を除去してから統計計算（中央値・最安・最高）
      const filteredPrices = removeOutliersByIQR(prices);
      min_price = filteredPrices[0];
      max_price = filteredPrices[filteredPrices.length - 1];
      suggested_price = filteredPrices[Math.floor(filteredPrices.length / 2)];
    }

    // 市場トレンド・競合比較エージェントに渡す簡易出品一覧（タイトル・価格のみ）
    const simplifiedItems = items
      .slice(0, 20)
      .map((item) => ({ title: item.title, price: parseFloat(item.price?.value || '0') }))
      .filter((item) => item.price > 0);
    const draft = productDraft || { title: keywords };

    // 市場トレンド分析・競合比較エージェントを並列実行（高速レスポンスのため）。
    // AIプロバイダー側の障害（APIキー不正・レート制限等）でここが失敗しても、既に計算済みの
    // 価格統計(suggested_price等)まで巻き添えで失わないよう、個別にtry/catchして続行する。
    let marketTrend;
    let competitorSuggestions;
    try {
      [marketTrend, competitorSuggestions] = await Promise.all([
        runMarketTrendAgent(keywords, simplifiedItems),
        runCompetitorAgent(draft, simplifiedItems.slice(0, 5)),
      ]);
    } catch (agentError) {
      console.error('市場トレンド/競合比較エージェントの実行に失敗しました（価格のみ返します）:', agentError?.response?.data || agentError);
    }

    // 総合判定スコアはLLM呼び出しではなく決定的な計算（高速・低コスト・再現性のため）
    const { overallScore, recommendation } = scoreListing({
      conditionResult: conditionAssessment,
      marketResult: marketTrend,
      productDraft: draft,
      pricing: { minPrice: min_price, maxPrice: max_price, userPrice: suggested_price },
    });

    return res.json({
      suggested_price,
      min_price,
      max_price,
      market_trend: marketTrend,
      competitor_suggestions: competitorSuggestions,
      overall_score: overallScore,
      recommendation,
    });
  } catch (error) {
    console.error('eBay Price Search Error:', error?.response?.data || error);
    return res.status(500).json({ error: '価格調査に失敗しました。' });
  }
});

// =================================================================
// 3. eBay 出品実行エンドポイント (/api/publish-ebay)
// =================================================================
app.post('/api/publish-ebay', requireAuth, async (req, res) => {
  try {
    const environment = await getActiveEbayEnv(req.userId);
    const connection = await getEbayConnection(req.userId, environment);
    if (!connection?.refresh_token) {
      return res.status(400).json({
        error: `eBayアカウント（${environment}）が未接続です。設定タブから「eBayでログイン」を行ってください。`,
      });
    }
    if (!connection.fulfillment_policy_id || !connection.return_policy_id) {
      return res.status(400).json({
        error: 'Business Policiesの準備が完了していません。設定タブから再度「eBayでログイン」を行ってください。',
      });
    }

    const { baseUrl } = getEbayEnvConfig(environment);
    const productData = req.body;
    const sku = `SKU-${Date.now()}`;

    const userAccessToken = await getUserAccessToken(req.userId, environment);
    const merchantLocationKey = connection.merchant_location_key || 'DEFAULT_LOCATION';
    const categoryId = productData.categoryId || '112529'; // カテゴリー未指定時のフォールバック（テスト用ID）

    // AIが生成したconditionがアプリ内で認識している4値のいずれとも一致しない場合のデフォルト
    let conditionKey = CONDITION_INFO[productData.condition] ? productData.condition : 'USED_EXCELLENT';

    // カテゴリごとに許可されるconditionは異なる（例: categoryId=112529は本番でNEW/USED_EXCELLENT/
    // USED_ACCEPTABLE/FOR_PARTS_OR_NOT_WORKINGのみ許可でUSED_GOODは不可、と実際のAPIで確認済み）。
    // 「AI判定が我々の4値に含まれるか」だけでは不十分なため、このカテゴリで実際に許可されている
    // conditionIdの一覧を取得し、含まれていなければ近い候補に差し替える
    // （取得自体に失敗した場合は従来通りconditionKeyのまま続行＝フェイルオープン）。
    try {
      const policyRes = await axios.get(
        `${baseUrl}/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies`,
        {
          headers: { Authorization: `Bearer ${userAccessToken}` },
          params: { filter: `categoryIds:{${categoryId}}` },
        }
      );
      const allowedIds = new Set(
        (policyRes.data.itemConditionPolicies?.[0]?.itemConditions || []).map((c) => c.conditionId)
      );
      if (allowedIds.size > 0 && !allowedIds.has(CONDITION_INFO[conditionKey].id)) {
        const fallback = FALLBACK_CONDITION_CANDIDATES.find((c) => allowedIds.has(c.id));
        if (fallback) {
          console.warn(
            `カテゴリ${categoryId}はcondition="${conditionKey}"を許可していないため"${fallback.key}"に差し替えます`
          );
          conditionKey = fallback.key;
        }
      }
    } catch (policyErr) {
      console.error('商品状態ポリシーの取得に失敗しました（判定値のまま続行）:', policyErr?.response?.data || policyErr);
    }

    const condition = CONDITION_INFO[conditionKey].enum;

    // フロントエンドが送ってくるblob:（Supabaseアップロード失敗時のフォールバック等）は
    // eBayから取得不可なため、http(s)で始まらないURLは除外する。1件も残らなければ
    // プレースホルダー画像にフォールバックする。eBayは複数枚のimageUrlsをそのままギャラリーとして扱う。
    const validImageUrls = Array.isArray(productData.imageUrls)
      ? productData.imageUrls.filter((url) => typeof url === 'string' && url.startsWith('http'))
      : [];
    const imageUrls = validImageUrls.length > 0
      ? validImageUrls
      : ['https://placehold.co/500x500.png?text=No+Image'];
    const imageUrl = imageUrls[0]; // 自アプリの出品履歴(listings)には代表画像1枚のみ保存する

    // Step2で確認・編集された商品仕様(Item Specifics)一覧をeBayのaspects形式に変換
    // eBayの商品仕様(Item Specifics)は1つの仕様名に複数の値を持てる仕様のため、
    // カンマ区切りの値（例: Features）は配列に分割して送る。
    // また、値1つあたり65文字までという制限があるため安全のため切り詰める。
    const aspects = {};
    for (const { key, value } of productData.aspects || []) {
      if (!key || !value) continue;
      const values = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (v.length > 65 ? v.slice(0, 65) : v));
      if (values.length > 0) {
        aspects[key] = values;
      }
    }
    // フォールバックのcategoryId(112529)が必須とするItem Specifics一式
    // （eBay Taxonomy APIのget_item_aspects_for_categoryで確認済み: Brand, Color, Connectivity, Model, Type）。
    // AIが検出できなかった項目は既定値で埋め、出品失敗を防ぐ。
    const REQUIRED_ASPECT_DEFAULTS = {
      Brand: productData.brand || 'Unbranded',
      Model: productData.model || 'N/A',
      Color: 'Does not apply',
      Type: 'Does not apply',
      Connectivity: 'Does not apply',
    };
    for (const [key, defaultValue] of Object.entries(REQUIRED_ASPECT_DEFAULTS)) {
      if (!aspects[key]) aspects[key] = [defaultValue];
    }

    // Step 1: Inventory Item の作成 (PUT /sell/inventory/v1/inventory_item/{sku})
    await axios.put(
      `${baseUrl}/sell/inventory/v1/inventory_item/${sku}`,
      {
        product: {
          title: productData.title,
          aspects,
          description: productData.description,
          imageUrls,
        },
        condition,
        availability: {
          shipToLocationAvailability: { quantity: 1 },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US',
        },
      }
    );

    // Step 2: Offer の作成 (POST /sell/inventory/v1/offer)
    const offerResponse = await axios.post(
      `${baseUrl}/sell/inventory/v1/offer`,
      {
        sku,
        marketplaceId: 'EBAY_US',
        format: 'FIXED_PRICE',
        availableQuantity: 1,
        categoryId,
        pricingSummary: {
          price: {
            value: productData.pricing.suggestedPrice.toString(),
            currency: 'USD',
          },
        },
        listingPolicies: {
          fulfillmentPolicyId: connection.fulfillment_policy_id,
          returnPolicyId: connection.return_policy_id,
          ...(process.env.EBAY_PAYMENT_POLICY_ID
            ? { paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID }
            : {}),
        },
        merchantLocationKey,
      },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US',
        },
      }
    );

    const offerId = offerResponse.data.offerId;

    // Step 3: Offer のパブリッシュ (POST /sell/inventory/v1/offer/{offerId}/publish)
    const publishResponse = await axios.post(
      `${baseUrl}/sell/inventory/v1/offer/${offerId}/publish`,
      {},
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
        },
      }
    );

    const listingId = publishResponse.data.listingId;

    // 出品履歴をDBに保存（失敗しても出品自体は成功しているため、ログのみでレスポンスは成功として返す）
    // カテゴリ別集計用に、商品仕様の"Type"（種類）をカテゴリとして流用する
    try {
      await saveListing({
        userId: req.userId,
        sku,
        listingId,
        title: productData.title,
        price: productData.pricing.suggestedPrice,
        imageUrl,
        category: aspects.Type?.[0] || 'Other',
        description: productData.description,
        aspects,
      });
    } catch (dbError) {
      console.error('出品履歴の保存に失敗しました:', dbError);
    }

    return res.json({
      success: true,
      listingId,
    });
  } catch (error) {
    console.error('eBay Publishing Error:', error?.response?.data || error);
    return res.status(500).json({ error: 'eBayへの出品処理に失敗しました。' });
  }
});

// =================================================================
// 出品履歴・売上サマリー取得エンドポイント (/api/listings)
// =================================================================
app.get('/api/listings', requireAuth, async (req, res) => {
  try {
    const [recentListingsRaw, salesSummary] = await Promise.all([
      getRecentListings(req.userId, 20),
      getSalesSummary(req.userId),
    ]);

    const recentListings = recentListingsRaw.map((row) => ({
      id: row.listing_id,
      title: row.title,
      price: Number(row.price),
      status: row.status,
      date: row.created_at.split('T')[0],
      imageUrl: row.image_url || undefined,
    }));

    return res.json({ recentListings, salesSummary });
  } catch (error) {
    console.error('出品履歴の取得に失敗しました:', error);
    return res.status(500).json({ error: '出品履歴の取得に失敗しました。' });
  }
});

// =================================================================
// 出品詳細取得エンドポイント (/api/listings/:id)
// 最近の出品一覧から選択した1件の詳細（説明文・商品仕様を含む全項目）を返す
// =================================================================
app.get('/api/listings/:id', requireAuth, async (req, res) => {
  try {
    const row = await getListingByListingId(req.userId, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '出品情報が見つかりませんでした。' });
    }

    return res.json({
      id: row.listing_id,
      title: row.title,
      price: Number(row.price),
      status: row.status,
      date: row.created_at.split('T')[0],
      imageUrl: row.image_url || undefined,
      category: row.category,
      description: row.description || '',
      aspects: row.aspects || {},
    });
  } catch (error) {
    console.error('出品詳細の取得に失敗しました:', error);
    return res.status(500).json({ error: '出品詳細の取得に失敗しました。' });
  }
});

// =================================================================
// 分析タブ向けエンドポイント (/api/analytics)
// =================================================================
app.get('/api/analytics', requireAuth, async (req, res) => {
  try {
    const analytics = await getAnalytics(req.userId);
    return res.json(analytics);
  } catch (error) {
    console.error('分析データの取得に失敗しました:', error);
    return res.status(500).json({ error: '分析データの取得に失敗しました。' });
  }
});

// =================================================================
// 4. eBayユーザー同意フロー (初回のrefresh_token取得用、一度だけ使う)
// =================================================================

// ① このURLをブラウザで開き、eBayアカウントでログイン・アプリ許可を行う。
//    ?env=SANDBOX|PRODUCTION でどちらの環境に接続するかを指定（省略時SANDBOX）。
//    どのアプリユーザー・環境の同意かを後で判別できるよう、"userId:environment"をstateに埋め込む
//    （eBayが同意後にそのままcallbackへ引き回してくれる標準的なOAuthの仕組み）。
app.get('/api/ebay/auth-url', requireAuth, (req, res) => {
  const environment = EBAY_ENVIRONMENTS.includes(req.query.env) ? req.query.env : 'SANDBOX';
  const { authUrl, clientId, ruName } = getEbayEnvConfig(environment);
  if (!clientId || !ruName) {
    return res.status(400).json({
      error: `EBAY_${environment}_CLIENT_ID / EBAY_${environment}_RU_NAME を.envに設定してください。`,
    });
  }

  const url = `${authUrl}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: 'code',
    scope: AUTH_SCOPES,
    // 予測可能な"userId:environment"ではなく、使い捨て・有効期限付きのランダムnonceをstateにする
    // （他人のユーザーIDを知っているだけでは偽装できないようにするためのOAuth CSRF対策）
    state: createOAuthState(req.userId, environment),
  }).toString()}`;

  return res.json({ url });
});

// ② eBayがEBAY_*_RU_NAMEに設定した「Your auth accepted URL」経由でここにリダイレクトしてくる。
//    このURLがRuNameの「Your auth accepted URL」として登録されている必要がある。
//    ブラウザの素のリダイレクトでAuthorizationヘッダーは付かないため、認証はstateパラメータ
//    （①で埋め込んだ"userId:environment"）で行う。
app.get('/api/ebay/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error || !code) {
    return res.status(400).send(`<h1>eBay認可に失敗しました</h1><p>${error ? escapeHtml(error) : 'codeがありません'}</p>`);
  }

  // stateは①で発行した使い捨てnonce。ここで一度きり消費し、対応するuserId/environmentを復元する
  // （不正・期限切れ・二重使用のnonceは復元できずnullになる）。
  const stateEntry = typeof state === 'string' ? consumeOAuthState(state) : null;
  if (!stateEntry || !EBAY_ENVIRONMENTS.includes(stateEntry.environment)) {
    return res.status(400).send('<h1>セッションが無効です</h1><p>リンクの有効期限が切れたか、既に使用済みです。アプリの設定タブから改めてログインし直してください。</p>');
  }
  const { userId, environment } = stateEntry;

  try {
    const tokens = await exchangeAuthCodeForTokens(code, environment);

    // アカウント削除通知（username付きで届く）との突合用に、同意直後のaccess_token
    // （AUTH_SCOPESでcommerce.identity.readonlyまで同意済み）でeBayユーザー名を取得しておく。
    // 取得失敗はログイン自体をブロックしない（ebay_usernameがnullのままになるだけ）。
    let ebayUsername = null;
    try {
      ebayUsername = await getEbayUsername(tokens.access_token, environment);
    } catch (identityErr) {
      console.error('eBayユーザー名の取得に失敗しました:', identityErr?.response?.data || identityErr);
    }

    // Supabaseのebay_connectionsにrefresh_tokenを先に保存する（Renderのような永続ディスクの無い
    // 環境でも再起動・再デプロイをまたいでログイン状態を維持できる、アプリ内ログインの本体）。
    // Business Policy自動セットアップが失敗しても、ログイン自体は必ず成功させる。
    await setEbayConnection(userId, environment, { refreshToken: tokens.refresh_token, ebayUsername });
    // 今接続した環境を、そのままこのユーザーのアクティブ環境として即座に切り替える
    await setActiveEbayEnv(userId, environment);

    // Business Policies・出荷元ロケーションをこのeBayアカウントに対して自動セットアップ
    // （get-or-createのため、既存アカウントの再ログインでも安全に何度でも実行できる）。
    // 注意: 認可コード交換直後のaccess_token(tokens.access_token)ではSell Account APIの
    // 呼び出しが不安定になることがあるため、保存直後のrefresh_tokenからrefresh token grantで
    // 改めて取得したaccess_token（実際の出品時と同じ経路）を使う。
    try {
      const accessToken = await getUserAccessToken(userId, environment);
      const policyInfo = await setupEbayPoliciesForToken(accessToken, environment);
      await setEbayConnection(userId, environment, { refreshToken: tokens.refresh_token, ...policyInfo });
    } catch (policyErr) {
      console.error('Business Policy自動セットアップに失敗しました:', policyErr?.response?.data || policyErr);
    }

    return res.send(
      `<h1>eBayとの連携が完了しました（${environment}）</h1>
       <p>このタブは自動的に閉じます。閉じない場合は手動で閉じてアプリのタブに戻ってください。再起動不要ですぐに出品できます。</p>
       <script>setTimeout(() => window.close(), 1500);</script>`
    );
  } catch (err) {
    console.error('eBay OAuth Callback Error:', err?.response?.data || err);
    return res.status(500).send('<h1>トークン交換に失敗しました</h1><p>サーバーのログを確認してください。</p>');
  }
});

// ③ 現在のeBay接続状態を確認する（設定タブでの表示用、Sandbox/Production両方＋現在の有効環境を返す）
app.get('/api/ebay/status', requireAuth, async (req, res) => {
  try {
    const [connections, activeEnv] = await Promise.all([
      getAllEbayConnections(req.userId),
      getActiveEbayEnv(req.userId),
    ]);
    const byEnv = Object.fromEntries(connections.map((c) => [c.environment, c]));

    return res.json({
      activeEnv,
      sandbox: { connected: !!byEnv.SANDBOX?.refresh_token, ebayUsername: byEnv.SANDBOX?.ebay_username || null },
      production: { connected: !!byEnv.PRODUCTION?.refresh_token, ebayUsername: byEnv.PRODUCTION?.ebay_username || null },
    });
  } catch (error) {
    console.error('eBay接続状態の確認に失敗しました:', error);
    return res.status(500).json({ error: 'eBay接続状態の確認に失敗しました。' });
  }
});

// ④ 設定タブから、既に接続済みの環境へ即座に切り替える（サーバー再起動・再デプロイ不要）
app.post('/api/ebay/active-env', requireAuth, async (req, res) => {
  try {
    const { environment } = req.body;
    if (!EBAY_ENVIRONMENTS.includes(environment)) {
      return res.status(400).json({ error: 'environmentはSANDBOXまたはPRODUCTIONを指定してください。' });
    }
    const connection = await getEbayConnection(req.userId, environment);
    if (!connection?.refresh_token) {
      return res.status(400).json({
        error: `${environment}のeBayアカウントが未接続です。先に「eBayでログイン」で接続してください。`,
      });
    }
    await setActiveEbayEnv(req.userId, environment);
    return res.json({ activeEnv: environment });
  } catch (error) {
    console.error('eBay環境切替に失敗しました:', error);
    return res.status(500).json({ error: 'eBay環境切替に失敗しました。' });
  }
});

// =================================================================
// 5. eBay Marketplace Account Deletion/Closure通知（コンプライアンス対応）
//    eBay Developer Portalの「Notifications」設定で、このエンドポイントのURLと
//    EBAY_DELETION_VERIFICATION_TOKENを登録すると、ユーザーがeBayアカウントを削除・閉鎖した際に
//    eBayから通知が届く。受信したら該当するebay_connectionsの行を削除し連携を確実に解除する。
//    どちらも認証必須(requireAuth)の対象外（eBay側からの素のサーバー間呼び出しのため）。
// =================================================================

// ① Developer Portalへの登録時、まずchallenge_code付きのGETで疎通確認が来る。
//    sha256(challengeCode + verificationToken + このエンドポイントの完全なURL)を返す必要がある。
app.get('/api/ebay/deletion-notification', (req, res) => {
  const { challenge_code: challengeCode } = req.query;
  const verificationToken = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
  const endpointUrl = process.env.EBAY_DELETION_ENDPOINT_URL;

  if (!challengeCode || !verificationToken || !endpointUrl) {
    return res.status(400).json({
      error: 'challenge_codeクエリパラメータ、またはEBAY_DELETION_VERIFICATION_TOKEN / EBAY_DELETION_ENDPOINT_URLの設定が不足しています。',
    });
  }

  const hash = crypto.createHash('sha256');
  hash.update(challengeCode);
  hash.update(verificationToken);
  hash.update(endpointUrl);

  return res.status(200).json({ challengeResponse: hash.digest('hex') });
});

// ② 実際の削除通知本体。該当eBayアカウントのebay_connections行を削除し連携を解除する。
//    eBayは非200応答やタイムアウトをリトライ対象とするため、処理の成否に関わらず速やかに200を返す。
//    x-ebay-signatureヘッダーで真正性を検証する（未検証だと、ebay_usernameさえ知っていれば
//    誰でも任意ユーザーのeBay連携を強制切断できてしまうため）。
//    署名が明確に不一致/不正な場合は412で拒否するが、鍵取得自体の失敗等インフラ起因で
//    検証できなかった場合は、本物の削除通知を取りこぼしてコンプライアンス違反になるリスクを
//    避けるためログを残した上で処理を続行する（フェイルオープン）。
app.post('/api/ebay/deletion-notification', async (req, res) => {
  try {
    const { verified, reason, infraError } = await verifyEbayNotificationSignature(
      req.body,
      req.headers['x-ebay-signature']
    );
    if (!verified) {
      console.error(`eBay削除通知の署名検証に失敗しました: ${reason}`);
      if (!infraError) {
        return res.status(412).json({ error: '署名検証に失敗しました。' });
      }
    }

    const username = req.body?.notification?.data?.username;
    if (username) {
      const deletedCount = await deleteEbayConnectionsByUsername(username);
      if (deletedCount > 0) {
        console.log(`eBayアカウント削除通知を受信し、連携を解除しました: ${username}（${deletedCount}件）`);
      } else {
        // 自アプリに接続されていないeBayアカウント（eBay側のテスト通知等）の場合はここに来る。
        // 誤って「解除しました」と記録しないよう区別する。
        console.log(`eBayアカウント削除通知を受信しましたが、自アプリに接続はありませんでした: ${username}`);
      }
    } else {
      console.warn('eBay削除通知にusernameが含まれていませんでした:', JSON.stringify(req.body));
    }
    return res.status(200).json({ status: 'received' });
  } catch (err) {
    console.error('eBay削除通知の処理に失敗しました:', err);
    return res.status(200).json({ status: 'received' });
  }
});

// 画像アップロードのサイズ上限超過・非画像ファイル拒否（multer）を分かりやすいJSONで返す
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err?.message === '画像ファイルのみアップロードできます。') {
    return res.status(400).json({ error: err.message || 'ファイルアップロードに失敗しました。' });
  }
  return next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend Server running on port ${PORT}`);
  console.log(`AI Provider: ${AI_PROVIDER}`);
});
