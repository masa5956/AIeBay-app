import type { CompetitorSuggestions, ConditionAssessment, MarketTrend, ProductAspect, ProductData } from '../types/listing';
import type {
  AnalyticsData,
  EbayEnvironment,
  EbayStatus,
  ListingDetail,
  RecentListing,
  ResearchArticle,
  ResearchCategory,
  SalesSummary,
} from '../types/app';
import { mockProductData } from '../mock/mockData';
import { supabase } from './supabaseClient';

const BACKEND_URL = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/api`;

// ログイン中ユーザーのSupabaseセッショントークンをAuthorizationヘッダーとして付与する。
// バックエンドはこのトークンを検証してuser_idを特定し、データをユーザーごとに分離する。
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 開発用モック: バックエンドを起動せずに画像解析結果を模擬する
export const mockAnalyzeImage = async (imageFiles: File[]): Promise<ProductData> => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return {
    ...mockProductData,
    imageUrls: imageFiles.map((file) => URL.createObjectURL(file)),
  };
};

// 開発用モック: バックエンドを起動せずに出品完了を模擬する
export const mockPublishItem = async (
  _productData: ProductData
): Promise<{ success: boolean; listingId: string }> => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { success: true, listingId: `MOCK-${Date.now()}` };
};

// 1. 画像(複数枚可)をバックエンドへ送りAI解析（基本抽出＋商品状態エージェント）を行い、
//    続けて価格・市場トレンド・競合比較・総合スコアの分析も取得してProductDataを組み立てる。
//    複数枚渡した場合、AIは全ての画像を1つの商品情報に統合して解析する（角度違いの写真を想定）。
export const analyzeImageWithAI = async (imageFiles: File[]): Promise<ProductData> => {
  const formData = new FormData();
  for (const file of imageFiles) {
    formData.append('images', file);
  }

  const response = await fetch(`${BACKEND_URL}/analyze-image`, {
    method: 'POST',
    headers: await authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error('AI解析リクエストに失敗しました');
  }

  const aiResult = await response.json();
  const conditionAssessment: ConditionAssessment | undefined = aiResult.conditionAssessment;

  // AIが返したItem Specifics（Brand/Model以外）をProductAspect[]に変換
  const extraAspects: ProductAspect[] = Object.entries(aiResult.aspects || {})
    .filter(([key, value]) => !['brand', 'model'].includes(key.toLowerCase()) && !!value)
    .map(([key, value]) => ({ key, value: String(value) }));

  const aspects: ProductAspect[] = [
    { key: 'Brand', value: aiResult.brand || '' },
    { key: 'Model', value: aiResult.model || '' },
    ...extraAspects,
  ];
  const title = aiResult.title || '';
  const description = aiResult.description || '';

  // 価格調査・市場トレンド・競合比較・総合スコアをまとめて取得。
  // 検索キーワードはtitle（eBayで検索されやすい単語を含むようAIが生成したSEOタイトル）を優先する。
  // brand+modelだと、AIがブランド・型番を読み取れず"Unbranded"/"Does not apply"のような
  // 汎用値になった場合に無意味な検索語になり、eBay検索が0件→分析全体がスキップされてしまうため。
  const fallbackKeywords = `${aiResult.brand} ${aiResult.model}`.trim();
  const analysisResult = await estimatePrice(
    title || fallbackKeywords || 'item',
    aiResult.condition || 'USED_EXCELLENT',
    { title, description, aspects },
    conditionAssessment
  );

  // Supabase Storageへのアップロードに成功していれば公開URL、失敗した分だけローカルのblob:にフォールバック
  // （aiResult.imageUrlsは失敗した画像がnullのまま返ってくるためindexを揃えて対応させる）
  const uploadedUrls: (string | null)[] = Array.isArray(aiResult.imageUrls) ? aiResult.imageUrls : [];
  const imageUrls = imageFiles.map((file, i) => uploadedUrls[i] || URL.createObjectURL(file));

  return {
    imageUrls,
    title,
    brand: aiResult.brand || '',
    model: aiResult.model || '',
    categoryName: 'General',
    condition: aiResult.condition || 'USED_EXCELLENT',
    aspects,
    description,
    pricing: {
      suggestedPrice: analysisResult.suggestedPrice,
      minPrice: analysisResult.minPrice,
      maxPrice: analysisResult.maxPrice,
      userPrice: analysisResult.suggestedPrice,
      acceptOffer: true,
    },
    analysis: {
      conditionAssessment,
      marketTrend: analysisResult.marketTrend,
      competitorSuggestions: analysisResult.competitorSuggestions,
      overallScore: analysisResult.overallScore,
      recommendation: analysisResult.recommendation,
    },
  };
};

// 2. eBay市場価格・市場トレンド・競合比較・総合スコアを調査する
//    （レスポンスはsnake_caseなのでcamelCaseへ変換する）
export const estimatePrice = async (
  keywords: string,
  condition: string,
  productDraft?: { title: string; description: string; aspects: ProductAspect[] },
  conditionAssessment?: ConditionAssessment
): Promise<{
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  marketTrend?: MarketTrend;
  competitorSuggestions?: CompetitorSuggestions;
  overallScore?: number;
  recommendation?: string;
}> => {
  try {
    const response = await fetch(`${BACKEND_URL}/estimate-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ keywords, condition, productDraft, conditionAssessment }),
    });
    if (!response.ok) return { suggestedPrice: 0, minPrice: 0, maxPrice: 0 };

    const data = await response.json();
    return {
      suggestedPrice: data.suggested_price || 0,
      minPrice: data.min_price || 0,
      maxPrice: data.max_price || 0,
      marketTrend: data.market_trend,
      competitorSuggestions: data.competitor_suggestions,
      overallScore: data.overall_score,
      recommendation: data.recommendation,
    };
  } catch (error) {
    return { suggestedPrice: 0, minPrice: 0, maxPrice: 0 };
  }
};

// 3. バックエンド経由でeBayへ出品する
export const publishToEbay = async (productData: ProductData): Promise<{ success: boolean; listingId: string }> => {
  const response = await fetch(`${BACKEND_URL}/publish-ebay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(productData),
  });

  if (!response.ok) {
    throw new Error('eBay出品処理に失敗しました');
  }

  return await response.json();
};

// 4. 最近の出品一覧・売上サマリーをバックエンド(DB)から取得する
export const getListings = async (): Promise<{ recentListings: RecentListing[]; salesSummary: SalesSummary }> => {
  const response = await fetch(`${BACKEND_URL}/listings`, { headers: await authHeaders() });
  if (!response.ok) {
    throw new Error('出品履歴の取得に失敗しました');
  }
  return await response.json();
};

// 4b. ホームの「すべて見る」画面向け: タイトル・カテゴリでキーワード検索した出品一覧を取得する
//     （queryが空文字の場合は全件を返す）
export const searchListings = async (query: string): Promise<RecentListing[]> => {
  const response = await fetch(`${BACKEND_URL}/listings/search?q=${encodeURIComponent(query)}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    throw new Error('出品検索に失敗しました');
  }
  const data = await response.json();
  return data.listings;
};

// 4c. リサーチタブ向け: カテゴリ別の最新記事一覧を取得する（RSSフィードベース、AI呼び出しなし）
export const getResearchArticles = async (category: ResearchCategory): Promise<ResearchArticle[]> => {
  const response = await fetch(`${BACKEND_URL}/research/articles?category=${encodeURIComponent(category)}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    throw new Error('リサーチ記事の取得に失敗しました');
  }
  const data = await response.json();
  return data.articles;
};

// 5. 分析タブ向けの月別出品額推移・カテゴリ別出品額構成をバックエンド(DB)から取得する
export const getAnalytics = async (): Promise<AnalyticsData> => {
  const response = await fetch(`${BACKEND_URL}/analytics`, { headers: await authHeaders() });
  if (!response.ok) {
    throw new Error('分析データの取得に失敗しました');
  }
  return await response.json();
};

// 6. 最近の出品一覧から選択した1件の詳細（説明文・商品仕様を含む）を取得する
export const getListingDetail = async (id: string): Promise<ListingDetail> => {
  const response = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(id)}`, { headers: await authHeaders() });
  if (!response.ok) {
    throw new Error('出品詳細の取得に失敗しました');
  }
  return await response.json();
};

// 7. eBayユーザー同意画面のURLを取得する（設定タブの「eBayでログイン」ボタンから使用）
export const getEbayAuthUrl = async (environment: EbayEnvironment): Promise<string> => {
  const response = await fetch(`${BACKEND_URL}/ebay/auth-url?env=${environment}`, { headers: await authHeaders() });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'eBay認証URLの取得に失敗しました');
  }
  const data = await response.json();
  return data.url;
};

// 8. eBayアカウントの接続状態（Sandbox/Production両方＋現在の有効環境）を確認する
export const getEbayStatus = async (): Promise<EbayStatus> => {
  const response = await fetch(`${BACKEND_URL}/ebay/status`, { headers: await authHeaders() });
  if (!response.ok) {
    return {
      activeEnv: 'SANDBOX',
      sandbox: { connected: false, ebayUsername: null },
      production: { connected: false, ebayUsername: null },
    };
  }
  return await response.json();
};

// 9. 既に接続済みのSandbox/Productionを設定タブから即時切り替える
export const setActiveEbayEnv = async (environment: EbayEnvironment): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/ebay/active-env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ environment }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'eBay環境の切替に失敗しました');
  }
};
