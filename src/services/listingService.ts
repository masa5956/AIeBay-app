import type { ProductAspect, ProductData } from '../types/listing';
import { mockProductData } from '../mock/mockData';

const BACKEND_URL = 'http://localhost:3001/api';

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

// 1. 画像をバックエンドへ送りAI解析を行い、続けて市場価格も取得してProductDataを組み立てる
export const analyzeImageWithAI = async (imageFile: File): Promise<ProductData> => {
  const formData = new FormData();
  formData.append('image', imageFile);

  const response = await fetch(`${BACKEND_URL}/analyze-image`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('AI解析リクエストに失敗しました');
  }

  const aiResult = await response.json();

  // 価格調査APIを呼び出し
  const priceData = await estimatePrice(
    `${aiResult.brand} ${aiResult.model}`,
    aiResult.condition || 'USED_EXCELLENT'
  );

  // AIが返したItem Specifics（Brand/Model以外）をProductAspect[]に変換
  const extraAspects: ProductAspect[] = Object.entries(aiResult.aspects || {})
    .filter(([key, value]) => !['brand', 'model'].includes(key.toLowerCase()) && !!value)
    .map(([key, value]) => ({ key, value: String(value) }));

  return {
    imageUrl: URL.createObjectURL(imageFile),
    title: aiResult.title || '',
    brand: aiResult.brand || '',
    model: aiResult.model || '',
    categoryName: 'General',
    condition: aiResult.condition || 'USED_EXCELLENT',
    aspects: [
      { key: 'Brand', value: aiResult.brand || '' },
      { key: 'Model', value: aiResult.model || '' },
      ...extraAspects,
    ],
    description: aiResult.description || '',
    pricing: {
      suggestedPrice: priceData.suggestedPrice,
      minPrice: priceData.minPrice,
      maxPrice: priceData.maxPrice,
      userPrice: priceData.suggestedPrice,
      acceptOffer: true,
    },
  };
};

// 2. eBay市場価格を調査する（レスポンスはsnake_caseなのでcamelCaseへ変換する）
export const estimatePrice = async (
  keywords: string,
  condition: string
): Promise<{ suggestedPrice: number; minPrice: number; maxPrice: number }> => {
  try {
    const response = await fetch(`${BACKEND_URL}/estimate-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, condition }),
    });
    if (!response.ok) return { suggestedPrice: 0, minPrice: 0, maxPrice: 0 };

    const data = await response.json();
    return {
      suggestedPrice: data.suggested_price || 0,
      minPrice: data.min_price || 0,
      maxPrice: data.max_price || 0,
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
