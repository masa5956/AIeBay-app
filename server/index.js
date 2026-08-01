import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import axios from 'axios';
import {
  EBAY_BASE_URL,
  EBAY_AUTH_URL,
  USER_SCOPES,
  getAppAccessToken,
  getUserAccessToken,
  exchangeAuthCodeForTokens,
} from './ebayAuth.js';
import { updateEnvValue } from './envFile.js';
import { AI_PROVIDER, generateImageJson } from './aiProvider.js';
import { runConditionAgent, runMarketTrendAgent, runCompetitorAgent, scoreListing } from './analysisAgents.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 画像アップロードのメモリ保持設定
const upload = multer({ storage: multer.memoryStorage() });

// eBayのcondition値からBrowse APIのconditionIdへのマッピング
const CONDITION_ID_MAP = {
  NEW: '1000',
  USED_EXCELLENT: '3000',
  USED_GOOD: '4000',
  USED_FAIR: '5000',
};

// 四分位範囲(IQR)アルゴリズムによる外れ値除去
function removeOutliersByIQR(sortedPrices) {
  const q1Index = Math.floor(sortedPrices.length * 0.25);
  const q3Index = Math.floor(sortedPrices.length * 0.75);
  const q1 = sortedPrices[q1Index];
  const q3 = sortedPrices[Math.min(q3Index, sortedPrices.length - 1)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const filtered = sortedPrices.filter((p) => p >= lowerBound && p <= upperBound);
  return filtered.length > 0 ? filtered : sortedPrices;
}

// =================================================================
// 1. AI画像解析エンドポイント (/api/analyze-image)
// =================================================================
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '画像ファイルが添付されていません。' });
    }

    // 画像をBase64変換
    const base64Image = req.file.buffer.toString('base64');

    // 基本情報抽出エージェントと商品状態エージェントを並列実行（高速レスポンスのため）
    const [parsedContent, conditionAssessment] = await Promise.all([
      generateImageJson(
        `この商品画像を分析し、eBay出品用の情報をJSONフォーマットのみで出力してください（説明や前置きは不要）。
実際のeBay出品ページの「Item Specifics（商品仕様）」欄を参考に、写っている商品のカテゴリから推測できる
具体的な仕様項目をできるだけ多く含めてください。ブランドやモデルが商品自体から読み取れない場合は
"Unbranded" / "Does not apply" を使ってください。

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
    "MPN": "型番が無ければ Does not apply",
    "UPC": "バーコードが読めなければ Does not apply",
    "Features": "特徴をカンマ区切りで",
    "Included Items": "付属品・同梱物をカンマ区切りで（分からなければ省略）"
  }
}

"aspects"は上記をベースに、写っている商品カテゴリに応じて適切な項目を追加・省略してよい
（例: 家電なら「Power Source」「Connectivity」、衣類なら「Style」「Pattern」など）。
値が不明な項目はキーごと省略してください。`,
        base64Image,
        req.file.mimetype
      ),
      runConditionAgent(base64Image, req.file.mimetype),
    ]);

    return res.json({ ...parsedContent, conditionAssessment });
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return res.status(500).json({ error: 'AI解析に失敗しました。' });
  }
});

// =================================================================
// 2. eBay 類似価格調査エンドポイント (/api/estimate-price)
// =================================================================
app.post('/api/estimate-price', async (req, res) => {
  try {
    const { keywords, condition, productDraft, conditionAssessment } = req.body;
    if (!keywords) {
      return res.status(400).json({ error: '検索キーワードが必要です。' });
    }

    const appToken = await getAppAccessToken();

    // Browse API による同一・類似商品の価格検索
    const searchResponse = await axios.get(
      `${EBAY_BASE_URL}/buy/browse/v1/item_summary/search`,
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        params: {
          q: keywords,
          limit: 50,
          filter: condition && CONDITION_ID_MAP[condition]
            ? `buyingOptions:{FIXED_PRICE},conditionIds:{${CONDITION_ID_MAP[condition]}}`
            : 'buyingOptions:{FIXED_PRICE}',
        },
      }
    );

    const items = searchResponse.data.itemSummaries || [];
    const prices = items
      .map((item) => parseFloat(item.price?.value || '0'))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      return res.json({ suggested_price: 0, min_price: 0, max_price: 0 });
    }

    // IQRアルゴリズムで外れ値を除去してから統計計算（中央値・最安・最高）
    const filteredPrices = removeOutliersByIQR(prices);
    const min_price = filteredPrices[0];
    const max_price = filteredPrices[filteredPrices.length - 1];
    const suggested_price = filteredPrices[Math.floor(filteredPrices.length / 2)];

    // 市場トレンド・競合比較エージェントに渡す簡易出品一覧（タイトル・価格のみ）
    const simplifiedItems = items
      .slice(0, 20)
      .map((item) => ({ title: item.title, price: parseFloat(item.price?.value || '0') }))
      .filter((item) => item.price > 0);
    const draft = productDraft || { title: keywords };

    // 市場トレンド分析・競合比較エージェントを並列実行（高速レスポンスのため）
    const [marketTrend, competitorSuggestions] = await Promise.all([
      runMarketTrendAgent(keywords, simplifiedItems),
      runCompetitorAgent(draft, simplifiedItems.slice(0, 5)),
    ]);

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
app.post('/api/publish-ebay', async (req, res) => {
  try {
    if (!process.env.EBAY_FULFILLMENT_POLICY_ID || !process.env.EBAY_RETURN_POLICY_ID) {
      return res.status(400).json({
        error: 'Business Policies未設定です。先に `npm run setup:policies` を実行してください。',
      });
    }

    const productData = req.body;
    const sku = `SKU-${Date.now()}`;

    const userAccessToken = await getUserAccessToken();
    const merchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'DEFAULT_LOCATION';
    const categoryId = productData.categoryId || '112529'; // カテゴリー未指定時のフォールバック（テスト用ID）

    // NOTE: 画像ホスティング未実装のため、フロントエンドが送ってくるblob:はeBayから取得不可。
    // http(s)で始まらないURLはプレースホルダー画像にフォールバックする（暫定対応）。
    const imageUrl = typeof productData.imageUrl === 'string' && productData.imageUrl.startsWith('http')
      ? productData.imageUrl
      : 'https://via.placeholder.com/500';

    // Step2で確認・編集された商品仕様(Item Specifics)一覧をeBayのaspects形式に変換
    const aspects = {};
    for (const { key, value } of productData.aspects || []) {
      if (key && value) {
        aspects[key] = [value];
      }
    }
    if (!aspects.Brand) aspects.Brand = [productData.brand || 'Unbranded'];
    if (!aspects.Model) aspects.Model = [productData.model || 'N/A'];

    // Step 1: Inventory Item の作成 (PUT /sell/inventory/v1/inventory_item/{sku})
    await axios.put(
      `${EBAY_BASE_URL}/sell/inventory/v1/inventory_item/${sku}`,
      {
        product: {
          title: productData.title,
          aspects,
          description: productData.description,
          imageUrls: [imageUrl],
        },
        condition: productData.condition || 'USED_EXCELLENT',
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
      `${EBAY_BASE_URL}/sell/inventory/v1/offer`,
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
          fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
          returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
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
      `${EBAY_BASE_URL}/sell/inventory/v1/offer/${offerId}/publish`,
      {},
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
        },
      }
    );

    return res.json({
      success: true,
      listingId: publishResponse.data.listingId,
    });
  } catch (error) {
    console.error('eBay Publishing Error:', error?.response?.data || error);
    return res.status(500).json({ error: 'eBayへの出品処理に失敗しました。' });
  }
});

// =================================================================
// 4. eBayユーザー同意フロー (初回のrefresh_token取得用、一度だけ使う)
// =================================================================

// ① このURLをブラウザで開き、eBayアカウントでログイン・アプリ許可を行う
app.get('/api/ebay/auth-url', (req, res) => {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_RU_NAME) {
    return res.status(400).json({ error: 'EBAY_CLIENT_ID / EBAY_RU_NAME を.envに設定してください。' });
  }

  const url = `${EBAY_AUTH_URL}?${new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID,
    redirect_uri: process.env.EBAY_RU_NAME,
    response_type: 'code',
    scope: USER_SCOPES,
  }).toString()}`;

  return res.json({ url });
});

// ② eBayがEBAY_RU_NAMEに設定した「Your auth accepted URL」経由でここにリダイレクトしてくる。
//    このURLがEBAY_RU_NAMEの「Your auth accepted URL」として登録されている必要がある。
app.get('/api/ebay/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.status(400).send(`<h1>eBay認可に失敗しました</h1><p>${error || 'codeがありません'}</p>`);
  }

  try {
    const tokens = await exchangeAuthCodeForTokens(code);
    updateEnvValue('EBAY_USER_REFRESH_TOKEN', tokens.refresh_token);

    return res.send(
      '<h1>eBayとの連携が完了しました</h1><p>refresh_tokenを.envに保存しました。このタブを閉じてサーバーを再起動してください。</p>'
    );
  } catch (err) {
    console.error('eBay OAuth Callback Error:', err?.response?.data || err);
    return res.status(500).send('<h1>トークン交換に失敗しました</h1><p>サーバーのログを確認してください。</p>');
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend Server running on port ${PORT}`);
  console.log(`AI Provider: ${AI_PROVIDER}`);
});
