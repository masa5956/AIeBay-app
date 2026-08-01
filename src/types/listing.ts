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

// 出品ウィザードで扱う商品データ本体
export interface ProductData {
  imageUrl?: string;
  title: string;
  brand: string;
  model: string;
  categoryName: string;
  condition: Condition;
  aspects: ProductAspect[];
  description: string;
  pricing: PricingInfo;
}
