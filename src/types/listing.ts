// 商品のコンディション区分（eBayのcondition列挙値に対応）
export type Condition = 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD' | 'USED_FAIR';

// 商品1点分のアスペクト（Brand, Modelなどeayの項目属性）。
// 「必須」かどうかはaspect自体には持たせない——カテゴリー切替のたびに前のカテゴリーの必須フラグが
// 残ってしまう不具合になるため、常にProductData.categoryAspectDefs(選択中カテゴリーの最新定義)から
// utils/productAspects.tsのisAspectRequired()で都度算出する
export interface ProductAspect {
  key: string;
  value: string;
}

// eBayカテゴリー候補（AI解析結果のタイトルから検索、ユーザーが選択して確定する）
export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
}

// 選択中カテゴリーのItem Specifics定義（eBay Taxonomy APIのget_item_aspects_for_category由来）
export interface CategoryAspectDef {
  name: string;
  required: boolean;
  mode: 'FREE_TEXT' | 'SELECTION_ONLY' | 'FREE_TEXT_OR_SELECTION';
  cardinality: 'SINGLE' | 'MULTI';
  allowedValues?: string[];
}

export type ListingFormat = 'FIXED_PRICE' | 'AUCTION';
export type AuctionDuration = 'DAYS_1' | 'DAYS_3' | 'DAYS_5' | 'DAYS_7' | 'DAYS_10';

// オークション形式の設定（開始価格・任意の最低落札価格・出品期間）
export interface AuctionSettings {
  duration: AuctionDuration;
  startingBid: number;
  reservePrice?: number;
}

// 価格情報（AI査定額・市場レンジ・ユーザー設定価格）
export interface PricingInfo {
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  userPrice: number;
  acceptOffer: boolean;
  format: ListingFormat;
  auction?: AuctionSettings;
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
  // 実際のeBayカテゴリーID（Taxonomy APIで選択・確定したもの）。未選択の間はundefined
  categoryId?: string;
  // AI解析結果のタイトルから取得したカテゴリー候補（ユーザーが選ぶまでは自動確定しない）
  categorySuggestions?: CategorySuggestion[];
  // 選択中カテゴリーのItem Specifics定義一式（必須項目バッジ・追加候補の表示に使う）
  categoryAspectDefs?: CategoryAspectDef[];
  condition: Condition;
  aspects: ProductAspect[];
  // 出品時点で販売可能な在庫数
  quantity: number;
  description: string;
  pricing: PricingInfo;
  analysis?: ListingAnalysis;
}
