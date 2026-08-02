import type { ProductData } from '../types/listing';

// バックエンド未起動時にウィザードの動作確認を行うためのサンプルデータ
export const mockProductData: Omit<ProductData, 'imageUrls'> = {
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black',
  brand: 'Sony',
  model: 'WH-1000XM5',
  categoryName: 'Consumer Electronics > Headphones',
  condition: 'USED_EXCELLENT',
  aspects: [
    { key: 'Brand', value: 'Sony' },
    { key: 'Model', value: 'WH-1000XM5' },
    { key: 'Type', value: 'Over-Ear Headphones' },
    { key: 'Color', value: 'Black' },
    { key: 'Connectivity', value: 'Bluetooth, Wired' },
    { key: 'Material', value: 'Plastic, Metal' },
    { key: 'Size', value: 'Standard' },
    { key: 'Department', value: 'Unisex Adults' },
    { key: 'Country/Region of Manufacture', value: 'China' },
    { key: 'MPN', value: 'WH-1000XM5' },
    { key: 'UPC', value: 'Does not apply' },
    { key: 'Features', value: 'Noise Cancelling, Bluetooth, Built-In Microphone' },
    { key: 'Included Items', value: 'Headphones, Charging Cable, Carrying Case' },
  ],
  description: 'AIが解析した商品説明文（モック）です。ノイズキャンセリング機能付きワイヤレスヘッドホン。',
  pricing: {
    suggestedPrice: 249.99,
    minPrice: 199.0,
    maxPrice: 289.0,
    userPrice: 249.99,
    acceptOffer: true,
  },
  analysis: {
    conditionAssessment: {
      conditionScore: 88,
      conditionLabel: 'Excellent',
      defects: ['イヤーパッドに軽い使用感'],
      notes: '目立った傷はなく、全体的に良好な状態です（モック）。',
    },
    marketTrend: {
      demandLevel: 'High',
      trendNote: '類似出品が少なく、価格帯も安定しているため需要が高い状況です（モック）。',
    },
    competitorSuggestions: {
      suggestions: ['タイトルに「Noise Cancelling」を追加すると露出が上がります（モック）。'],
      competitivePriceNote: '競合と比べて妥当な価格帯です（モック）。',
    },
    overallScore: 82,
    recommendation: '出品準備は良好です。このまま出品できます（モック）。',
  },
};
