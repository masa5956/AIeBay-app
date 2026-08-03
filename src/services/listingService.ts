import type {
  CategoryAspectDef,
  CategorySuggestion,
  CompetitorSuggestions,
  ConditionAssessment,
  MarketTrend,
  ProductAspect,
  ProductData,
} from '../types/listing';
import type {
  AnalyticsData,
  EbayEnvironment,
  EbayStatus,
  ListingDetail,
  RecentListing,
  ResearchArticle,
  SalesSummary,
  ShippingAddress,
  ShippingAddressStatus,
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
    quantity: 1,
    description,
    pricing: {
      suggestedPrice: analysisResult.suggestedPrice,
      minPrice: analysisResult.minPrice,
      maxPrice: analysisResult.maxPrice,
      userPrice: analysisResult.suggestedPrice,
      acceptOffer: true,
      format: 'FIXED_PRICE',
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

// 4c. リサーチタブ向け: キーワードで記事を検索する（固定カテゴリ・自由入力とも共通、AI呼び出しなし）
export const searchResearchArticles = async (query: string): Promise<ResearchArticle[]> => {
  const response = await fetch(`${BACKEND_URL}/research/articles?q=${encodeURIComponent(query)}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'リサーチ記事の検索に失敗しました');
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

// 9b. 指定環境のeBay連携を解除する（壊れた接続情報を再接続前にクリアする手段としても使う）
export const disconnectEbay = async (environment: EbayEnvironment): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/ebay/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ environment }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'eBay連携の解除に失敗しました');
  }
};

// 10. 出荷元住所の状態を取得する。平文は含まず、マスクされたプレビュー(maskedPreview)+
//     hasAddressのみ返る（平文の取得はrevealShippingAddress経由、パスワード再認証必須）
export const getShippingAddressStatus = async (): Promise<ShippingAddressStatus> => {
  const response = await fetch(`${BACKEND_URL}/settings/shipping-address`, { headers: await authHeaders() });
  if (!response.ok) {
    throw new Error('出荷元住所の取得に失敗しました');
  }
  return await response.json();
};

// 10b. パスワードを再入力して平文の住所を取得する（設定タブの「表示/編集する」ボタンから使用）
export const revealShippingAddress = async (password: string): Promise<ShippingAddress | null> => {
  const response = await fetch(`${BACKEND_URL}/settings/shipping-address/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'パスワードの確認に失敗しました');
  }
  const data = await response.json();
  return data.address;
};

// 11. 出荷元住所（ユーザーごと）を保存する。「eBayでログイン」より先に設定しておく必要がある
export const saveShippingAddress = async (address: ShippingAddress): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/settings/shipping-address`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(address),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '出荷元住所の保存に失敗しました');
  }
};

// 12. 出荷元住所（ユーザーごと）を削除する（データ最小化のため、不要になったら消せるようにする）
export const deleteShippingAddress = async (): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/settings/shipping-address`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '出荷元住所の削除に失敗しました');
  }
};

// 13. AI解析結果のタイトル等からeBayカテゴリー候補を検索する（自動確定はせずユーザーに選ばせる）
export const getCategorySuggestions = async (query: string): Promise<CategorySuggestion[]> => {
  const response = await fetch(`${BACKEND_URL}/ebay/category-suggestions?q=${encodeURIComponent(query)}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.suggestions || [];
};

// 14. 選択中カテゴリーのItem Specifics定義（必須項目・選択肢）を取得する
export const getCategoryAspects = async (categoryId: string): Promise<CategoryAspectDef[]> => {
  const response = await fetch(`${BACKEND_URL}/ebay/category-aspects?categoryId=${encodeURIComponent(categoryId)}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data.aspects || [];
};

// 15. 出品をキャンセルする（withdrawOffer。再出品可能な形で出品を終了する）
export const cancelListing = async (listingId: string): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(listingId)}/cancel`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '出品キャンセルに失敗しました');
  }
};

// 16. 手動で「売却済み」としてマークする（eBay側は変更せず、アプリ内の記録のみ更新）
export const markListingSold = async (listingId: string): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(listingId)}/mark-sold`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '売却済みマークに失敗しました');
  }
};

// 17. 公開中の出品の在庫数を変更する
export const updateListingQuantity = async (listingId: string, quantity: number): Promise<void> => {
  const response = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(listingId)}/quantity`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ quantity }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '在庫数の変更に失敗しました');
  }
};
