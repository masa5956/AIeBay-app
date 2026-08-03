import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { getCategorySuggestions, getItemAspectsForCategory } from './ebayTaxonomy.js';
import {
  getEbayConnection,
  getAllEbayConnections,
  setEbayConnection,
  deleteEbayConnection,
  deleteEbayConnectionsByUsername,
} from './ebayConnectionsRepository.js';
import { clearCachedUserToken } from './ebayTokenCache.js';
import {
  getActiveEbayEnv,
  setActiveEbayEnv,
  getShippingAddress,
  setShippingAddress,
  clearShippingAddress,
} from './userSettingsRepository.js';
import { setupEbayPoliciesForToken } from './setupPolicies.js';
import { requireAuth } from './authMiddleware.js';
import { AI_PROVIDER, TEXT_AI_PROVIDER, generateImageJson } from './aiProvider.js';
import { runConditionAgent, runMarketResearchAgent, runMarketTrendAgent, runCompetitorAgent, scoreListing } from './analysisAgents.js';
import { supabase, supabaseAnon, PRODUCT_IMAGES_BUCKET } from './supabaseClient.js';
import {
  saveListing,
  getRecentListings,
  getAllListings,
  getSalesSummary,
  getAnalytics,
  getListingByListingId,
  updateListingStatus,
  updateListingQuantity,
} from './listingsRepository.js';
import { removeOutliersByIQR } from './priceStats.js';
import { createOAuthState, consumeOAuthState } from './oauthStateStore.js';
import { verifyEbayNotificationSignature } from './ebayNotificationVerifier.js';
import { searchResearchArticles } from './researchFeeds.js';

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
// セキュリティヘッダー(X-Content-Type-Options, X-Frame-Options, HSTS等)を付与する。
// CSPはデフォルトのままだと/api/ebay/callback等が返すインラインscript付きHTMLを壊すため無効化する
// （このアプリのAPIはJSONが主でHTMLレスポンスはこの2エンドポイントのみの例外的な用途のため）。
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));

// レートリミッター。CSRFトークンの代わりにBearerトークン認証を使っている（cookieセッションが
// 無いためCSRFの実害が薄い）が、ブルートフォース・AIクォータ濫用・OAuth関連の乱打は別問題のため
// 個別に制限する。
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const expensiveLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const addressRevealLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

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

app.post('/api/analyze-image', expensiveLimiter, requireAuth, upload.array('images', MAX_ANALYZE_IMAGES), async (req, res) => {
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

    const draft = productDraft || { title: keywords };
    const brand = (productDraft?.aspects || []).find((a) => a.key === 'Brand')?.value || '';
    const model = (productDraft?.aspects || []).find((a) => a.key === 'Model')?.value || '';

    // 価格調査は、Gemini + Google検索グラウンディングによるインターネット全体の相場調査を主経路とする。
    // eBay Browse APIのキーワード完全一致検索は、AIが生成したタイトルがブランド/型番を誤認識・
    // 一般化した場合（例: "Unbranded"寄りの表現）に0件になりやすく「取得できない」ケースが多かった。
    // Web検索グラウンディングならAI自身が広く相場を推測できるため、この問題が起きにくい。
    let min_price = 0;
    let max_price = 0;
    let suggested_price = 0;
    let marketTrend;
    let competitorSuggestions;
    // Google検索グラウンディングはGemini専用機能のため、TEXT_AI_PROVIDER=groq（Geminiのクォータ
    // 枯渇時などにテキスト系エージェントを丸ごとGroqへ逃がす設定）のときはこの呼び出し自体を
    // スキップする。呼んでも確実に失敗するだけで、無駄な待ち時間とクォータ消費が発生するため。
    if (TEXT_AI_PROVIDER !== 'groq') {
      try {
        const research = await runMarketResearchAgent({ title: keywords, brand, model, condition, conditionAssessment });
        min_price = Number(research.min_price) || 0;
        max_price = Number(research.max_price) || 0;
        suggested_price = Number(research.suggested_price) || 0;
        marketTrend = research.market_trend;
        competitorSuggestions = research.competitor_suggestions;
      } catch (researchError) {
        console.error('Gemini検索による価格調査に失敗しました。eBay Browse APIへフォールバックします:', researchError?.response?.data || researchError);
      }
    }

    // フォールバック: Gemini検索調査が失敗した、または有効な価格を返さなかった場合のみ、
    // 従来のeBay Browse APIベースの調査を行う（Sandboxはダミーデータしか無いため常にProductionを使う。
    // Production未設定の場合のみ現在の出品先環境で代用）。
    if (suggested_price === 0) {
      const productionConfig = getEbayEnvConfig('PRODUCTION');
      const priceResearchEnv = (productionConfig.clientId && productionConfig.clientSecret)
        ? 'PRODUCTION'
        : await getActiveEbayEnv(req.userId);
      const { baseUrl } = getEbayEnvConfig(priceResearchEnv);
      const appToken = await getAppAccessToken(priceResearchEnv);

      // `q`が長いSEOタイトルそのままだと0件になりやすいため、0件のときは段階的に検索語を
      // 単純化して再検索する（brand+model → タイトル先頭の数語）。
      const brandModel = `${brand} ${model}`.trim();
      const shortTitle = keywords.split(/\s+/).slice(0, 4).join(' ');
      const candidateQueries = [keywords, brandModel, shortTitle].filter(
        (q, i, arr) => q && arr.indexOf(q) === i // 空文字・重複を除去
      );

      let items = [];
      let usedQuery = keywords;
      for (const q of candidateQueries) {
        const searchResponse = await axios.get(
          `${baseUrl}/buy/browse/v1/item_summary/search`,
          {
            headers: {
              Authorization: `Bearer ${appToken}`,
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
            params: {
              q,
              limit: 50,
              filter: condition && CONDITION_INFO[condition]
                ? `buyingOptions:{FIXED_PRICE},conditionIds:{${CONDITION_INFO[condition].id}}`
                : 'buyingOptions:{FIXED_PRICE}',
            },
          }
        );
        items = searchResponse.data.itemSummaries || [];
        usedQuery = q;
        if (items.length > 0) break;
      }
      if (items.length === 0) {
        console.warn(`価格調査フォールバック: 検索語を段階的に変えても0件でした（試行順: ${candidateQueries.join(' / ')}）`);
      } else if (usedQuery !== keywords) {
        console.log(`価格調査フォールバック: 元のキーワードでは0件のため"${usedQuery}"で再検索し${items.length}件ヒットしました`);
      }
      const prices = items
        .map((item) => parseFloat(item.price?.value || '0'))
        .filter((p) => p > 0)
        .sort((a, b) => a - b);

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

      // AIプロバイダー側の障害（APIキー不正・レート制限等）でここが失敗しても、既に計算済みの
      // 価格統計(suggested_price等)まで巻き添えで失わないよう、個別にtry/catchして続行する。
      try {
        [marketTrend, competitorSuggestions] = await Promise.all([
          runMarketTrendAgent(keywords, simplifiedItems),
          runCompetitorAgent(draft, simplifiedItems.slice(0, 5)),
        ]);
      } catch (agentError) {
        console.error('市場トレンド/競合比較エージェントの実行に失敗しました（価格のみ返します）:', agentError?.response?.data || agentError);
      }
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

// オークション形式の期間はeBayが対応する5値のみ許可する（30日・GTCはオークションでは非対応）
const AUCTION_DURATIONS = new Set(['DAYS_1', 'DAYS_3', 'DAYS_5', 'DAYS_7', 'DAYS_10']);

// validateShippingAddressと同型（coerce→範囲チェック→{auction}か{error}を返す）。
// eBayへの実際のAPI呼び出しの前に検証し、無駄なInventory Item作成を防ぐ。
function validateAuctionSettings(pricing) {
  const duration = pricing?.auction?.duration;
  const startingBid = Number(pricing?.auction?.startingBid);
  const reservePriceRaw = pricing?.auction?.reservePrice;

  if (!AUCTION_DURATIONS.has(duration)) {
    return { error: 'オークションの期間は1/3/5/7/10日のいずれかを指定してください。' };
  }
  if (!Number.isFinite(startingBid) || startingBid <= 0) {
    return { error: '開始価格は0より大きい数値で指定してください。' };
  }
  let reservePrice;
  if (reservePriceRaw !== undefined && reservePriceRaw !== null && reservePriceRaw !== '') {
    reservePrice = Number(reservePriceRaw);
    if (!Number.isFinite(reservePrice) || reservePrice < startingBid) {
      return { error: '最低落札価格は開始価格以上の数値で指定してください。' };
    }
  }
  return { auction: { duration, startingBid, ...(reservePrice !== undefined ? { reservePrice } : {}) } };
}

// =================================================================
// 3. eBay 出品実行エンドポイント (/api/publish-ebay)
// =================================================================
app.post('/api/publish-ebay', expensiveLimiter, requireAuth, async (req, res) => {
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
    // merchant_location_keyが未設定のまま出品を試みると、eBay側に実在しないロケーションキー
    // （旧コードは'DEFAULT_LOCATION'という文字列に決め打ちでフォールバックしていた）で
    // Offerをpublishすることになり、errorId 25002「Location information not found」で
    // 失敗する。ここで事前に弾き、原因が分かるメッセージを返す。
    if (!connection.merchant_location_key) {
      return res.status(400).json({
        error:
          '出荷元ロケーションの準備が完了していません。設定タブで出荷元住所を入力し、' +
          '再度「eBayでログイン」を行ってください。',
      });
    }

    const { baseUrl } = getEbayEnvConfig(environment);
    const productData = req.body;
    const sku = `SKU-${Date.now()}`;

    const userAccessToken = await getUserAccessToken(req.userId, environment);
    const merchantLocationKey = connection.merchant_location_key;
    const categoryId = productData.categoryId || '112529'; // カテゴリー未指定時のフォールバック（テスト用ID）

    // 在庫数（出品時点で販売可能な数量）。範囲外・非整数はデフォルト1に丸める
    const quantity = Number.isInteger(productData.quantity) && productData.quantity >= 0 && productData.quantity <= 9999
      ? productData.quantity
      : 1;

    // 販売方法（固定価格 / オークション）。オークションの場合は期間・開始価格・(任意の)最低落札価格を
    // eBayへの呼び出し前に検証し、無駄なInventory Item作成を防ぐ。
    const isAuction = productData.pricing?.format === 'AUCTION';
    let auctionSettings = null;
    if (isAuction) {
      const { auction, error: auctionError } = validateAuctionSettings(productData.pricing);
      if (auctionError) {
        return res.status(400).json({ error: auctionError });
      }
      auctionSettings = auction;
    }

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
    // カテゴリー別の必須Item Specificsを、eBay Taxonomy API(get_item_aspects_for_category)から
    // 動的に取得して検証する（旧実装はcategoryId=112529専用の固定5項目の穴埋めだったため、他カテゴリーでは
    // 不正確だった）。フロント側(Step2/Step4)で事前に埋めさせているため、通常ここで引っかかるのは
    // キャッシュ不整合等の異常系のみ。取得自体の失敗（Taxonomy APIの障害等）はfail-open
    // （Condition検証と同じ挙動＝ログのみで続行）とし、インフラ都合で出品自体をブロックしない。
    try {
      const aspectDefs = await getItemAspectsForCategory(environment, categoryId);
      const missingRequired = aspectDefs
        .filter((d) => d.required && !(aspects[d.name]?.length > 0))
        .map((d) => d.name);
      if (missingRequired.length > 0) {
        return res.status(400).json({
          error: `必須の商品仕様が未入力です: ${missingRequired.join(', ')}`,
        });
      }
    } catch (aspectErr) {
      console.error(
        'カテゴリ別必須Item Specificsの取得に失敗しました（未検証のまま出品を続行します）:',
        aspectErr?.response?.data || aspectErr
      );
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
          shipToLocationAvailability: { quantity },
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
    // 固定価格とオークションでpricingSummaryの形が異なる（オークションは開始価格/最低落札価格、
    // 固定価格は通常の価格1本）。createOfferはeBay Sell Inventory APIがformat: 'AUCTION'を
    // 直接サポートしているため、Trading API等の別APIへの切り替えは不要。
    const offerResponse = await axios.post(
      `${baseUrl}/sell/inventory/v1/offer`,
      {
        sku,
        marketplaceId: 'EBAY_US',
        format: isAuction ? 'AUCTION' : 'FIXED_PRICE',
        availableQuantity: quantity,
        categoryId,
        pricingSummary: isAuction
          ? {
              auctionStartPrice: { value: auctionSettings.startingBid.toString(), currency: 'USD' },
              ...(auctionSettings.reservePrice !== undefined
                ? { auctionReservePrice: { value: auctionSettings.reservePrice.toString(), currency: 'USD' } }
                : {}),
            }
          : {
              price: {
                value: productData.pricing.suggestedPrice.toString(),
                currency: 'USD',
              },
            },
        ...(isAuction ? { listingDuration: auctionSettings.duration } : {}),
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
        offerId,
        quantity,
        format: isAuction ? 'AUCTION' : 'FIXED_PRICE',
        title: productData.title,
        price: isAuction ? auctionSettings.startingBid : productData.pricing.suggestedPrice,
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
// カテゴリー候補・カテゴリー別Item Specifics取得エンドポイント
// eBay Taxonomy APIの薄いラッパー。第三者サイトからのカテゴリー手動カタログ化ではなく、
// eBay自身の常に最新のデータを都度取得する（server/ebayTaxonomy.js側で数時間キャッシュ）。
// =================================================================
app.get('/api/ebay/category-suggestions', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: '検索キーワード(q)を指定してください。' });
    }
    const environment = await getActiveEbayEnv(req.userId);
    const suggestions = await getCategorySuggestions(environment, q);
    return res.json({ suggestions });
  } catch (error) {
    console.error('カテゴリー候補の取得に失敗しました:', error?.response?.data || error);
    return res.status(500).json({ error: 'カテゴリー候補の取得に失敗しました。' });
  }
});

app.get('/api/ebay/category-aspects', requireAuth, async (req, res) => {
  try {
    const categoryId = String(req.query.categoryId || '').trim();
    if (!categoryId) {
      return res.status(400).json({ error: 'categoryIdを指定してください。' });
    }
    const environment = await getActiveEbayEnv(req.userId);
    const aspects = await getItemAspectsForCategory(environment, categoryId);
    return res.json({ aspects });
  } catch (error) {
    console.error('カテゴリー別Item Specificsの取得に失敗しました:', error?.response?.data || error);
    return res.status(500).json({ error: 'カテゴリー別Item Specificsの取得に失敗しました。' });
  }
});

// =================================================================
// 出品キャンセル・手動売却済みマーク・在庫数変更エンドポイント
// いずれも「自分の出品」であることをgetListingByListingIdの所有権(user_id)確認で担保してから処理する。
// =================================================================

// 出品を取り消す。withdrawOfferはOfferオブジェクトを残したまま出品を終了する
// （eBay Seller Hubの「出品を終了」と同じ挙動、後で再出品も可能）。既に公開中のOfferには
// 直接使えないdeleteOfferではなくこちらを使う。
app.post('/api/listings/:id/cancel', requireAuth, async (req, res) => {
  try {
    const row = await getListingByListingId(req.userId, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '出品情報が見つかりませんでした。' });
    }
    if (row.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'この出品は既に終了しています。' });
    }
    if (!row.offer_id) {
      return res.status(400).json({
        error: 'この出品はアプリからは取り消せません（データ移行前の出品のため）。eBay Seller Hubから直接操作してください。',
      });
    }

    const environment = await getActiveEbayEnv(req.userId);
    const { baseUrl } = getEbayEnvConfig(environment);
    const userAccessToken = await getUserAccessToken(req.userId, environment);
    await axios.post(
      `${baseUrl}/sell/inventory/v1/offer/${row.offer_id}/withdraw`,
      {},
      { headers: { Authorization: `Bearer ${userAccessToken}` } }
    );

    await updateListingStatus(req.userId, req.params.id, 'CANCELLED');
    return res.json({ success: true });
  } catch (error) {
    console.error('出品キャンセルに失敗しました:', error?.response?.data || error);
    return res.status(500).json({ error: '出品キャンセルに失敗しました。' });
  }
});

// 手動で「売却済み」としてマークする。eBay側は変更しない（実際の売却はeBay上で起きているため）。
// eBayの売却通知webhookが無く売上集計が常に0円になる既知の制限を、手動運用で実用的に解消する。
app.post('/api/listings/:id/mark-sold', requireAuth, async (req, res) => {
  try {
    const row = await getListingByListingId(req.userId, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '出品情報が見つかりませんでした。' });
    }
    if (row.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'この出品は既に終了しています。' });
    }
    await updateListingStatus(req.userId, req.params.id, 'SOLD');
    return res.json({ success: true });
  } catch (error) {
    console.error('売却済みマークに失敗しました:', error);
    return res.status(500).json({ error: '売却済みマークに失敗しました。' });
  }
});

// 在庫数(quantity)を変更する。bulk_update_price_quantityはInventory ItemとOfferを1回のAPI呼び出しで
// 同時更新できる、公開中リスティングの在庫数変更に特化したeBay APIのため、
// 個別にinventory_item/offerをPUTし直すより安全（更新漏れ・不整合が起きない）。
app.patch('/api/listings/:id/quantity', requireAuth, async (req, res) => {
  try {
    const quantity = Number(req.body?.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) {
      return res.status(400).json({ error: '在庫数は0〜9999の整数で指定してください。' });
    }

    const row = await getListingByListingId(req.userId, req.params.id);
    if (!row) {
      return res.status(404).json({ error: '出品情報が見つかりませんでした。' });
    }
    if (row.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'この出品は既に終了しているため在庫数を変更できません。' });
    }
    if (!row.offer_id) {
      return res.status(400).json({
        error: 'この出品はアプリからは在庫数を変更できません（データ移行前の出品のため）。',
      });
    }

    const environment = await getActiveEbayEnv(req.userId);
    const { baseUrl } = getEbayEnvConfig(environment);
    const userAccessToken = await getUserAccessToken(req.userId, environment);
    await axios.post(
      `${baseUrl}/sell/inventory/v1/bulk_update_price_quantity`,
      {
        requests: [
          {
            offers: [{ offerId: row.offer_id, availableQuantity: quantity }],
            shipToLocationAvailability: { quantity },
            sku: row.sku,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' } }
    );

    await updateListingQuantity(req.userId, req.params.id, quantity);
    return res.json({ success: true, quantity });
  } catch (error) {
    console.error('在庫数の変更に失敗しました:', error?.response?.data || error);
    return res.status(500).json({ error: '在庫数の変更に失敗しました。' });
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
      category: row.category || 'Other',
    }));

    return res.json({ recentListings, salesSummary });
  } catch (error) {
    console.error('出品履歴の取得に失敗しました:', error);
    return res.status(500).json({ error: '出品履歴の取得に失敗しました。' });
  }
});

// =================================================================
// 出品検索エンドポイント (/api/listings/search) — ホームの「すべて見る」画面用。
// タイトル・カテゴリを対象にキーワードで絞り込む（大文字小文字を区別しない部分一致）。
// 注意: このルートは/api/listings/:idより前で定義する必要がある
// （Expressは定義順に一致判定するため、後だと"search"が:idとして誤って一致してしまう）。
// =================================================================
app.get('/api/listings/search', requireAuth, async (req, res) => {
  try {
    const keyword = String(req.query.q || '').trim().toLowerCase();
    const allListings = await getAllListings(req.userId);

    const filtered = keyword
      ? allListings.filter(
          (row) =>
            (row.title || '').toLowerCase().includes(keyword) ||
            (row.category || '').toLowerCase().includes(keyword)
        )
      : allListings;

    const listings = filtered.map((row) => ({
      id: row.listing_id,
      title: row.title,
      price: Number(row.price),
      status: row.status,
      date: row.created_at.split('T')[0],
      imageUrl: row.image_url || undefined,
      category: row.category || 'Other',
    }));

    return res.json({ listings });
  } catch (error) {
    console.error('出品検索に失敗しました:', error);
    return res.status(500).json({ error: '出品検索に失敗しました。' });
  }
});

// =================================================================
// リサーチタブ: カテゴリ別の最新記事一覧取得エンドポイント
// AI呼び出しは行わず、カテゴリごとのRSSフィードを取得・マージして返す（無料・レート制限なし）
// =================================================================
app.get('/api/research/articles', requireAuth, async (req, res) => {
  try {
    const keyword = String(req.query.q || '').trim();
    if (!keyword) {
      return res.status(400).json({ error: '検索キーワード(q)を指定してください。' });
    }
    const articles = await searchResearchArticles(keyword);
    return res.json({ articles });
  } catch (error) {
    console.error('リサーチ記事の取得に失敗しました:', error);
    return res.status(500).json({ error: error.message || 'リサーチ記事の取得に失敗しました。' });
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
      quantity: Number.isInteger(row.quantity) ? row.quantity : 1,
      format: row.listing_format || 'FIXED_PRICE',
      canManage: !!row.offer_id,
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
app.get('/api/ebay/auth-url', expensiveLimiter, requireAuth, async (req, res) => {
  const environment = EBAY_ENVIRONMENTS.includes(req.query.env) ? req.query.env : 'SANDBOX';
  const { authUrl, clientId, ruName } = getEbayEnvConfig(environment);
  if (!clientId || !ruName) {
    return res.status(400).json({
      error: `EBAY_${environment}_CLIENT_ID / EBAY_${environment}_RU_NAME を.envに設定してください。`,
    });
  }

  // ログイン直後にこのアカウント上へ出荷元ロケーションを自動作成するため、住所が未設定のまま
  // 接続させると「作成できず出品時にエラー」という分かりにくい失敗になる。先にここで弾く。
  const address = await getShippingAddress(req.userId).catch(() => null);
  if (!address) {
    return res.status(400).json({
      error: '先に設定タブで出荷元住所を入力してください。',
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
// OAuthコールバックの結果ページ共通レイアウト。エラー時に「閉じる」ボタンすら無い
// 行き止まりのページになっていた（新規タブで開くため、ユーザーが手動でタブを閉じて
// 元のアプリタブに戻る必要があったが、その導線が無かった）ため、常にボタンを用意する。
function oauthResultPage({ title, message, autoClose = false }) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; text-align: center;">
      <h1 style="font-size: 18px;">${title}</h1>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">${message}</p>
      <button
        onclick="window.close()"
        style="margin-top: 16px; padding: 10px 24px; border-radius: 8px; border: none; background: #1e293b; color: white; font-weight: bold; font-size: 13px; cursor: pointer;"
      >このタブを閉じる</button>
    </div>
    ${autoClose ? '<script>setTimeout(() => window.close(), 1500);</script>' : ''}
  `;
}

app.get('/api/ebay/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error || !code) {
    return res.status(400).send(oauthResultPage({
      title: 'eBay認可に失敗しました',
      message: error ? escapeHtml(error) : 'codeがありません',
    }));
  }

  // stateは①で発行した使い捨てnonce。ここで一度きり消費し、対応するuserId/environmentを復元する
  // （不正・期限切れ・二重使用のnonceは復元できずnullになる）。よくある原因: 10分のTTL切れ、
  // 同じリンクを2回開いた（二重消費）、または開発中にバックエンドが再起動しstateがメモリごと
  // 消えた（このstoreはDBではなくメモリ上のみで保持されているため）。
  const stateEntry = typeof state === 'string' ? consumeOAuthState(state) : null;
  if (!stateEntry || !EBAY_ENVIRONMENTS.includes(stateEntry.environment)) {
    return res.status(400).send(oauthResultPage({
      title: 'セッションが無効です',
      message:
        'リンクの有効期限が切れたか、既に使用済みです。このタブを閉じてアプリの設定タブから改めて「eBayでログイン」をやり直してください。',
    }));
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
    let policySetupError = null;
    try {
      const accessToken = await getUserAccessToken(userId, environment);
      const address = await getShippingAddress(userId);
      const policyInfo = await setupEbayPoliciesForToken(accessToken, environment, address);
      await setEbayConnection(userId, environment, { refreshToken: tokens.refresh_token, ...policyInfo });
    } catch (policyErr) {
      console.error('Business Policy自動セットアップに失敗しました:', policyErr?.response?.data || policyErr);
      policySetupError = policyErr?.response?.data?.errors?.[0]?.message || policyErr.message;
    }

    // アカウント連携自体(refresh_token保存)は成功していても、Business Policy/出荷元ロケーションの
    // 自動セットアップが失敗しているとこの後の出品がerrorId 25002等で失敗する。以前はここで
    // 常に「連携完了」の成功メッセージだけを返していたため、この種の失敗が起きていることに
    // ユーザーが気づけず、出品時に初めてエラーに遭遇していた。ここで明示的に警告する。
    if (policySetupError) {
      return res.send(oauthResultPage({
        title: `eBayアカウントの連携は完了しましたが、一部設定に失敗しました（${environment}）`,
        message:
          `Business Policy・出荷元ロケーションの自動セットアップに失敗しました: ${escapeHtml(policySetupError)}` +
          '<br><br>出荷元住所が正しく保存されているか設定タブで確認のうえ、もう一度「eBayでログイン」をやり直してください。',
      }));
    }

    return res.send(oauthResultPage({
      title: `eBayとの連携が完了しました（${environment}）`,
      message: 'このタブは自動的に閉じます。閉じない場合は下のボタンで閉じてアプリのタブに戻ってください。再起動不要ですぐに出品できます。',
      autoClose: true,
    }));
  } catch (err) {
    console.error('eBay OAuth Callback Error:', err?.response?.data || err);
    return res.status(500).send(oauthResultPage({
      title: 'トークン交換に失敗しました',
      message: 'サーバーのログを確認してください。',
    }));
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

// ⑤ 指定環境のeBay連携を解除する。壊れた接続情報（実在しないmerchant_location_key等）を
// 再接続前に確実にクリアする手段としても使う——setEbayConnectionはupsertのため、古い
// fulfillment_policy_id/merchant_location_key等が新しい値で上書きされない限り残り続けてしまう。
app.post('/api/ebay/disconnect', requireAuth, async (req, res) => {
  try {
    const { environment } = req.body;
    if (!EBAY_ENVIRONMENTS.includes(environment)) {
      return res.status(400).json({ error: 'environmentはSANDBOXまたはPRODUCTIONを指定してください。' });
    }
    await deleteEbayConnection(req.userId, environment);
    clearCachedUserToken(req.userId, environment);
    return res.json({ success: true });
  } catch (error) {
    console.error('eBay連携の解除に失敗しました:', error);
    return res.status(500).json({ error: 'eBay連携の解除に失敗しました。' });
  }
});

// ⑤ 出荷元住所（ユーザーごと、暗号化して保存）。「eBayでログイン」時にこのアカウント上へ
//    出荷元ロケーションとして自動作成されるため、接続前に設定しておく必要がある
//    （未設定のままだとauth-urlが400を返す）。DBにはaddressCrypto.jsで暗号化した値のみが
//    保存され、平文はレスポンス/リクエストの往復以外どこにも残らない（ログにも出力しない）。
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

function validateShippingAddress(body) {
  const addressLine1 = String(body.addressLine1 || '').trim();
  const city = String(body.city || '').trim();
  const stateOrProvince = String(body.stateOrProvince || '').trim();
  const postalCode = String(body.postalCode || '').trim();
  const country = String(body.country || '').trim().toUpperCase();

  if (!addressLine1 || addressLine1.length > 200) {
    return { error: '住所1行目は1〜200文字で入力してください。' };
  }
  if (!city || city.length > 100) {
    return { error: '市区町村は1〜100文字で入力してください。' };
  }
  if (stateOrProvince.length > 100) {
    return { error: '都道府県は100文字以内で入力してください。' };
  }
  if (!postalCode || postalCode.length > 20) {
    return { error: '郵便番号は1〜20文字で入力してください。' };
  }
  if (!COUNTRY_CODE_PATTERN.test(country)) {
    return { error: '国は「JP」「US」のようなISO 3166-1 alpha-2の2文字コードで入力してください。' };
  }
  return { address: { addressLine1, city, stateOrProvince, postalCode, country } };
}

// デフォルトでは平文住所を返さず、マスクされたプレビュー+hasAddressのみ返す（画面上のマスク表示だけでなく、
// API境界自体でも「パスワード再認証を通さない限り平文住所がクライアントに届かない」ようにするため）。
// 平文の取得は下のPOST /reveal（パスワード再認証必須）でのみ行う。
app.get('/api/settings/shipping-address', requireAuth, async (req, res) => {
  try {
    const address = await getShippingAddress(req.userId);
    if (!address) {
      return res.json({ hasAddress: false, maskedPreview: null });
    }
    const maskedPreview = `${address.city || '???'} / ${address.country}`;
    return res.json({ hasAddress: true, maskedPreview });
  } catch (error) {
    console.error('出荷元住所の取得に失敗しました:', error.message);
    return res.status(500).json({ error: '出荷元住所の取得に失敗しました。' });
  }
});

// パスワード再認証を経て初めて平文の住所を返す（要望「限界まで」に対応する、API境界での実質的なアクセス制御）。
// 検証はsupabaseAnonクライアントでのsignInWithPasswordの成否のみを利用し、返ってくるセッションは
// 破棄する（req.userIdのログインセッションを不用意に上書き・ローテーションしないため）。
app.post('/api/settings/shipping-address/reveal', addressRevealLimiter, requireAuth, async (req, res) => {
  try {
    if (!supabase || !supabaseAnon) {
      return res.status(500).json({ error: 'サーバー側の設定不備のため利用できません。' });
    }
    const password = String(req.body?.password || '');
    if (!password) {
      return res.status(400).json({ error: 'パスワードを入力してください。' });
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(req.userId);
    const email = userData?.user?.email;
    if (userError || !email) {
      return res.status(401).json({ error: '本人確認に失敗しました。再度ログインし直してください。' });
    }

    const { error: signInError } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (signInError) {
      return res.status(401).json({ error: 'パスワードが正しくありません。' });
    }

    const address = await getShippingAddress(req.userId);
    return res.json({ address });
  } catch (error) {
    console.error('住所の再認証表示に失敗しました:', error.message);
    return res.status(500).json({ error: '住所の再認証表示に失敗しました。' });
  }
});

app.put('/api/settings/shipping-address', requireAuth, async (req, res) => {
  const { address, error: validationError } = validateShippingAddress(req.body || {});
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }
  try {
    await setShippingAddress(req.userId, address);
    return res.json({ success: true });
  } catch (error) {
    console.error('出荷元住所の保存に失敗しました:', error.message);
    return res.status(500).json({ error: '出荷元住所の保存に失敗しました。' });
  }
});

// データ最小化のため、ユーザーが明示的に住所を削除できるようにする
app.delete('/api/settings/shipping-address', requireAuth, async (req, res) => {
  try {
    await clearShippingAddress(req.userId);
    return res.json({ success: true });
  } catch (error) {
    console.error('出荷元住所の削除に失敗しました:', error.message);
    return res.status(500).json({ error: '出荷元住所の削除に失敗しました。' });
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
