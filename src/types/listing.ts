// 出品先プラットフォーム。メルカリには第三者向けの自動出品APIが存在しないため、
// メルカリ選択時はAIが日本語の出品文言を生成するのみで、実際の出品はユーザーが
// メルカリアプリ/サイトへ手動でコピー&ペーストして行う（eBayのような自動出品API連携は無い）。
export type Platform = 'ebay' | 'mercari';

// 商品のコンディション区分（eBayのcondition列挙値に対応）
export type Condition = 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD' | 'USED_FAIR';

// メルカリ出品フォームの商品の状態（6段階、メルカリの実際の選択肢に準拠）
export const MERCARI_CONDITIONS = [
  '新品、未使用',
  '未使用に近い',
  '目立った傷や汚れなし',
  'やや傷や汚れあり',
  '傷や汚れあり',
  '全体的に状態が悪い',
] as const;
export type MercariCondition = (typeof MERCARI_CONDITIONS)[number];

// 商品1点分のアスペクト（Brand, Modelなどeayの項目属性）
export interface ProductAspect {
  key: string;
  value: string;
}

// 価格情報（AI査定額・市場レンジ・ユーザー設定価格）
export interface PricingInfo {
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  userPrice: number;
  acceptOffer: boolean;
}

// 商品状態・欠陥検出エージェントの結果
export interface ConditionAssessment {
  conditionScore: number;
  conditionLabel: string;
  defects: string[];
  notes: string;
}

// 市場トレンド・需要分析エージェントの結果
export interface MarketTrend {
  demandLevel: 'High' | 'Medium' | 'Low';
  trendNote: string;
}

// 競合比較エージェントの結果
export interface CompetitorSuggestions {
  suggestions: string[];
  competitivePriceNote: string;
}

// AIマルチエージェント分析の結果一式（出品前の参考情報、最終判断は人間が行う）
export interface ListingAnalysis {
  conditionAssessment?: ConditionAssessment;
  marketTrend?: MarketTrend;
  competitorSuggestions?: CompetitorSuggestions;
  overallScore?: number;
  recommendation?: string;
}

// 出品ウィザードで扱う商品データ本体
export interface ProductData {
  platform: Platform;
  imageUrl?: string;
  title: string;
  brand: string;
  model: string;
  categoryName: string;
  condition: Condition;
  aspects: ProductAspect[];
  description: string;
  pricing: PricingInfo;
  analysis?: ListingAnalysis;
  // platform === 'mercari' のときのみ使用
  mercariCondition?: MercariCondition;
  mercariCategorySuggestion?: string;
}
