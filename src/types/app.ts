export type TabType = 'home' | 'analytics' | 'settings';

export interface RecentListing {
  id: string;
  title: string;
  price: number;
  status: 'ACTIVE' | 'SOLD' | 'DRAFT';
  date: string;
  imageUrl?: string;
}

export interface SalesSummary {
  totalRevenue: number;
  monthlyRevenue: number;
  activeListingsCount: number;
  soldItemsCount: number;
}

// 分析タブ用の集計データ（DBの実出品データから算出。売却実績ではなく出品時点の金額ベース）
export interface MonthlyTrendPoint {
  month: string; // 'YYYY-MM'
  value: number;
}

export interface CategoryBreakdownPoint {
  category: string;
  value: number;
}

export interface AnalyticsData {
  monthlyTrend: MonthlyTrendPoint[];
  categoryBreakdown: CategoryBreakdownPoint[];
}

// ジャンル比較機能: eBay Browse APIの現在の出品状況からの相対的な需要スコア
// （売却実績ではなく、出品数・価格帯の安定度からの推定である点に注意）
export interface GenreComparisonResult {
  genre: string;
  activeListingCount: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  demandScore: number;
}
