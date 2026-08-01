export type TabType = 'home' | 'analytics' | 'settings';

export interface RecentListing {
  id: string;
  title: string;
  price: number;
  status: 'ACTIVE' | 'SOLD' | 'DRAFT';
  date: string;
  imageUrl?: string;
}

// 出品詳細画面用（最近の出品一覧をタップした際に取得する全項目）
export interface ListingDetail extends RecentListing {
  category: string;
  description: string;
  aspects: Record<string, string[]>;
}

export interface SalesSummary {
  totalRevenue: number;
  monthlyRevenue: number;
  // 先月の売上が0の場合は変化率が定義できないためnull（バッジ非表示の判定に使う）
  monthlyRevenueChangePercent: number | null;
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
