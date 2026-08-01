import type {
  CompetitorSuggestions,
  ConditionAssessment,
  MarketTrend,
  Platform,
  ProductAspect,
  ProductData,
} from '../types/listing';
import type { AnalyticsData, GenreComparisonResult, RecentListing, SalesSummary } from '../types/app';
import { mockProductData } from '../mock/mockData';

const BACKEND_URL = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/api`;

// 開発用モック: バックエンドを起動せずに画像解析結果を模擬する
export const mockAnalyzeImage = async (imageFile: File): Promise<ProductData> => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return {
    ...mockProductData,
    imageUrl: URL.createObjectURL(imageFile),
  };
};

// 開発用モック: バックエンドを起動せずに出品完了を模擬する
export const mockPublishItem = async (
  _productData: ProductData
): Promise<{ success: boolean; listingId: string }> => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { success: true, listingId: `MOCK-${Date.now()}` };
};

// 1. 画像をバックエンドへ送りAI解析を行いProductDataを組み立てる。
//    platform='ebay'（既定）: 基本抽出＋商品状態エージェントに続けて価格・市場トレンド・競合比較・総合スコアを取得。
//    platform='mercari': メルカリには自動出品APIが無いため、日本語の出品文言を生成するのみで
//    価格査定(eBay Browse API)は呼ばない。価格はユーザーがStep3で手動設定する。
export const analyzeImageWithAI = async (imageFile: File, platform: Platform = 'ebay'): Promise<ProductData> => {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('platform', platform);

  const response = await fetch(`${BACKEND_URL}/analyze-image`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('AI解析リクエストに失敗しました');
  }

  const aiResult = await response.json();
  const conditionAssessment: ConditionAssessment | undefined = aiResult.conditionAssessment;
  // Supabase Storageへのアップロードに成功していれば公開URL、失敗時のみローカルのblob:にフォールバック
  const imageUrl = aiResult.imageUrl || URL.createObjectURL(imageFile);

  if (platform === 'mercari') {
    return {
      platform: 'mercari',
      imageUrl,
      title: aiResult.title || '',
      brand: aiResult.brand || '',
      model: aiResult.model || '',
      categoryName: 'General',
      condition: 'USED_GOOD', // メルカリフローでは未使用（UI非表示）
      aspects: [],
      description: aiResult.description || '',
      pricing: { suggestedPrice: 0, minPrice: 0, maxPrice: 0, userPrice: 0, acceptOffer: false },
      analysis: { conditionAssessment },
      mercariCondition: aiResult.mercariCondition,
      mercariCategorySuggestion: aiResult.mercariCategorySuggestion,
    };
  }

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

  // 価格調査・市場トレンド・競合比較・総合スコアをまとめて取得
  const analysisResult = await estimatePrice(
    `${aiResult.brand} ${aiResult.model}`,
    aiResult.condition || 'USED_EXCELLENT',
    { title, description, aspects },
    conditionAssessment
  );

  return {
    platform: 'ebay',
    imageUrl,
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
      headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(productData),
  });

  if (!response.ok) {
    throw new Error('eBay出品処理に失敗しました');
  }

  return await response.json();
};

// 3b. メルカリへの手動出品完了をアプリの履歴(DB)に記録する。
//     メルカリには自動出品APIが無いため、外部への出品リクエストは発生しない
//     （ユーザーがメルカリアプリ/サイトへ手動でコピー&ペーストして出品した後に呼び出す）。
export const completeMercariListing = async (
  productData: ProductData
): Promise<{ success: boolean; listingId: string }> => {
  const response = await fetch(`${BACKEND_URL}/mercari/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: productData.title,
      price: productData.pricing.userPrice,
      imageUrl: productData.imageUrl,
      category: productData.mercariCategorySuggestion,
    }),
  });

  if (!response.ok) {
    throw new Error('出品履歴の記録に失敗しました');
  }

  return await response.json();
};

// 4. 最近の出品一覧・売上サマリーをバックエンド(DB)から取得する
export const getListings = async (): Promise<{ recentListings: RecentListing[]; salesSummary: SalesSummary }> => {
  const response = await fetch(`${BACKEND_URL}/listings`);
  if (!response.ok) {
    throw new Error('出品履歴の取得に失敗しました');
  }
  return await response.json();
};

// 5. 分析タブ向けの月別出品額推移・カテゴリ別出品額構成をバックエンド(DB)から取得する
export const getAnalytics = async (): Promise<AnalyticsData> => {
  const response = await fetch(`${BACKEND_URL}/analytics`);
  if (!response.ok) {
    throw new Error('分析データの取得に失敗しました');
  }
  return await response.json();
};

// 6. 出品を検討している複数ジャンル(キーワード)をeBay Browse APIの現況で比較する
export const compareGenres = async (genres: string[]): Promise<GenreComparisonResult[]> => {
  const response = await fetch(`${BACKEND_URL}/genre-comparison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genres }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'ジャンル比較の取得に失敗しました');
  }
  const data = await response.json();
  return data.results;
};
