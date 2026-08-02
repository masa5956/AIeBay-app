// 商品のコンディション区分（eBayのcondition列挙値に対応）
export type Condition = 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD' | 'USED_FAIR';

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
  // 複数枚対応（1枚以上）。先頭が代表画像として扱われる
  imageUrls: string[];
  title: string;
  brand: string;
  model: string;
  categoryName: string;
  condition: Condition;
  aspects: ProductAspect[];
  description: string;
  pricing: PricingInfo;
  analysis?: ListingAnalysis;
}
