import type { ProductData } from '../types/listing';

// バックエンド未起動時にウィザードの動作確認を行うためのサンプルデータ
export const mockProductData: Omit<ProductData, 'imageUrl'> = {
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black',
  brand: 'Sony',
  model: 'WH-1000XM5',
  categoryName: 'Consumer Electronics > Headphones',
  condition: 'USED_EXCELLENT',
  aspects: [
    { key: 'Brand', value: 'Sony' },
    { key: 'Model', value: 'WH-1000XM5' },
  ],
  description: 'AIが解析した商品説明文（モック）です。ノイズキャンセリング機能付きワイヤレスヘッドホン。',
  pricing: {
    suggestedPrice: 249.99,
    minPrice: 199.0,
    maxPrice: 289.0,
    userPrice: 249.99,
    acceptOffer: true,
  },
};
