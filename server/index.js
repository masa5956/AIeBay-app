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
import { supabase, PRODUCT_IMAGES_BUCKET } from './supabaseClient.js';
import { saveListing, getRecentListings, getSalesSummary, getAnalytics } from './listingsRepository.js';
import { removeOutliersByIQR } from './priceStats.js';
import { compareGenres } from './genreComparison.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 画像アップロードのメモリ保持設定
const upload = multer({ storage: multer.memoryStorage() });

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

// eBayのcondition値からBrowse APIのconditionIdへのマッピング
const CONDITION_ID_MAP = {
  NEW: '1000',
  USED_EXCELLENT: '3000',
  USED_GOOD: '4000',
  USED_FAIR: '5000',
};


// =================================================================
// 1. AI画像解析エンドポイント (/api/analyze-image)
// =================================================================
const EBAY_ANALYSIS_PROMPT = `この商品画像を分析し、eBay出品用の情報をJSONフォーマットのみで出力してください（説明や前置きは不要）。
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

// メルカリには第三者向けの自動出品APIが無いため、ここではメルカリの出品フォームに
// そのままコピー&ペーストできる日本語の文言を生成するのみ（実際の出品はユーザーが手動で行う）。
const MERCARI_ANALYSIS_PROMPT = `この商品画像を分析し、フリマアプリ「メルカリ」に出品するための情報を
日本語のJSONフォーマットのみで出力してください（説明や前置きは不要）。

出力フォーマット:
{
  "title": "メルカリでよく検索されるキーワードを含む40文字以内の商品名（日本語）",
  "brand": "ブランド名（不明ならDoes not apply）",
  "model": "型番（不明なら空文字）",
  "mercariCondition": "新品、未使用 / 未使用に近い / 目立った傷や汚れなし / やや傷や汚れあり / 傷や汚れあり / 全体的に状態が悪い のいずれか",
  "mercariCategorySuggestion": "メルカリのカテゴリ階層の推測（例: レディース > バッグ > ハンドバッグ）",
  "description": "日本語の商品説明文（300〜500字程度、以下の構成）。1段落目: 商品概要（何の商品か、ブランド・用途）。2段落目: サイズ・素材・仕様など分かる範囲で具体的に。3段落目: 商品の状態（傷・汚れ・使用感を画像から具体的かつ正直に記述、誇張しない）。4段落目: 付属品（分かれば記載、無ければ省略）。"
}`;

app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '画像ファイルが添付されていません。' });
    }

    const platform = req.body.platform === 'mercari' ? 'mercari' : 'ebay';
    const prompt = platform === 'mercari' ? MERCARI_ANALYSIS_PROMPT : EBAY_ANALYSIS_PROMPT;

    // 画像をBase64変換
    const base64Image = req.file.buffer.toString('base64');

    // 基本情報抽出・商品状態エージェント・画像アップロードを並列実行（高速レスポンスのため）
    const [parsedContent, conditionAssessment, imageUrl] = await Promise.all([
      generateImageJson(prompt, base64Image, req.file.mimetype),
      runConditionAgent(base64Image, req.file.mimetype),
      uploadProductImage(req.file.buffer, req.file.mimetype),
    ]);

    return res.json({ ...parsedContent, conditionAssessment, imageUrl, platform });
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

    // AIが生成したconditionがeBayの許容する4値のいずれとも一致しない場合に備え、
    // 不正な値はデフォルトにフォールバックする（Inventory APIが「conditionがカテゴリに対し無効」として
    // 出品全体を拒否するのを防ぐため）
    const VALID_CONDITIONS = ['NEW', 'USED_EXCELLENT', 'USED_GOOD', 'USED_FAIR'];
    const condition = VALID_CONDITIONS.includes(productData.condition) ? productData.condition : 'USED_EXCELLENT';

    // NOTE: 画像ホスティング未実装のため、フロントエンドが送ってくるblob:はeBayから取得不可。
    // http(s)で始まらないURLはプレースホルダー画像にフォールバックする（暫定対応）。
    const imageUrl = typeof productData.imageUrl === 'string' && productData.imageUrl.startsWith('http')
      ? productData.imageUrl
      : 'https://via.placeholder.com/500';

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
      `${EBAY_BASE_URL}/sell/inventory/v1/inventory_item/${sku}`,
      {
        product: {
          title: productData.title,
          aspects,
          description: productData.description,
          imageUrls: [imageUrl],
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

    const listingId = publishResponse.data.listingId;

    // 出品履歴をDBに保存（失敗しても出品自体は成功しているため、ログのみでレスポンスは成功として返す）
    // カテゴリ別集計用に、商品仕様の"Type"（種類）をカテゴリとして流用する
    try {
      await saveListing({
        sku,
        listingId,
        title: productData.title,
        price: productData.pricing.suggestedPrice,
        imageUrl,
        category: aspects.Type?.[0] || 'Other',
        platform: 'ebay',
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
// メルカリ出品完了の記録エンドポイント (/api/mercari/complete)
// メルカリには自動出品APIが無いため、ユーザーがメルカリアプリ/サイトへ手動でコピー&ペーストして
// 出品した後に、アプリ側の履歴(ホーム画面・分析タブ)に反映するためだけの記録用エンドポイント。
// 外部APIへのリクエストは一切発生しない。
// =================================================================
app.post('/api/mercari/complete', async (req, res) => {
  try {
    const { title, price, imageUrl, category } = req.body;
    if (!title || typeof price !== 'number') {
      return res.status(400).json({ error: 'title・priceが必要です。' });
    }

    const sku = `MERCARI-${Date.now()}`;
    await saveListing({
      sku,
      listingId: sku,
      title,
      price,
      imageUrl,
      category: category || 'Other',
      platform: 'mercari',
      status: 'MANUAL',
    });

    return res.json({ success: true, listingId: sku });
  } catch (error) {
    console.error('メルカリ出品記録エラー:', error);
    return res.status(500).json({ error: '出品履歴の記録に失敗しました。' });
  }
});

// =================================================================
// 出品履歴・売上サマリー取得エンドポイント (/api/listings)
// =================================================================
app.get('/api/listings', async (req, res) => {
  try {
    const [recentListingsRaw, salesSummary] = await Promise.all([
      getRecentListings(20),
      getSalesSummary(),
    ]);

    const recentListings = recentListingsRaw.map((row) => ({
      id: row.listing_id,
      title: row.title,
      price: Number(row.price),
      status: row.status,
      date: row.created_at.split('T')[0],
      imageUrl: row.image_url || undefined,
      platform: row.platform || 'ebay',
    }));

    return res.json({ recentListings, salesSummary });
  } catch (error) {
    console.error('出品履歴の取得に失敗しました:', error);
    return res.status(500).json({ error: '出品履歴の取得に失敗しました。' });
  }
});

// =================================================================
// 分析タブ向けエンドポイント (/api/analytics)
// =================================================================
app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await getAnalytics();
    return res.json(analytics);
  } catch (error) {
    console.error('分析データの取得に失敗しました:', error);
    return res.status(500).json({ error: '分析データの取得に失敗しました。' });
  }
});

// =================================================================
// ジャンル比較エンドポイント (/api/genre-comparison)
// 出品を検討している複数ジャンル(キーワード)について、eBay Browse APIの
// 現在のアクティブ出品状況(件数・価格帯)から相対的な需要スコアを算出する。
// =================================================================
app.post('/api/genre-comparison', async (req, res) => {
  try {
    const { genres } = req.body;
    if (!Array.isArray(genres) || genres.length < 2) {
      return res.status(400).json({ error: '比較するジャンルを2件以上指定してください。' });
    }
    if (genres.length > 6) {
      return res.status(400).json({ error: '比較できるジャンルは最大6件までです。' });
    }

    const results = await compareGenres(genres);
    return res.json({ results });
  } catch (error) {
    console.error('ジャンル比較の取得に失敗しました:', error?.response?.data || error);
    return res.status(500).json({ error: 'ジャンル比較の取得に失敗しました。' });
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

    // Render等の再起動時にファイルシステムが引き継がれない環境向けに、
    // refresh_tokenを画面にも表示し、ダッシュボードの環境変数へ手動反映できるようにする
    return res.send(
      `<h1>eBayとの連携が完了しました</h1>
       <p>refresh_tokenを.envに保存しました（このプロセスが再起動されるまで有効）。</p>
       <p>Renderなど永続ディスクの無い環境では、以下の値をコピーして
       ダッシュボードの環境変数 <code>EBAY_USER_REFRESH_TOKEN</code> に手動で設定してください。</p>
       <textarea readonly style="width:100%;height:4em;">${tokens.refresh_token}</textarea>
       <p>設定後はこのページを閉じてください。</p>`
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
