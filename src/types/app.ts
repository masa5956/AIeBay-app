export type TabType = 'home' | 'research' | 'analytics' | 'settings';

// リサーチタブ: カテゴリ＝検索クエリのラベル付け。isCustom=trueはユーザーが自由検索から
// 追加したカテゴリ（削除可能、localStorageに永続化）、falseはアプリ標準の固定カテゴリ。
export interface ResearchCategoryDef {
  key: string;
  label: string;
  query: string;
  isCustom: boolean;
}

// リサーチタブ: ニュースAPI(Serper.dev、Googleニュースの検索結果)から取得した記事1件
export interface ResearchArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

// 出荷元住所（ユーザーごと。設定タブで入力し、「eBayでログイン」時にそのeBayアカウント上へ
// 出荷元ロケーションとして自動作成される。バックエンドではAES-256-GCMで暗号化して保存される）
export interface ShippingAddress {
  addressLine1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
}

// GET /api/settings/shipping-addressの通常レスポンス。平文住所は含まず、マスクされたプレビュー
// (例: "東京都 / JP")とhasAddressのみを返す（平文取得はパスワード再認証必須のrevealShippingAddress経由のみ）
export interface ShippingAddressStatus {
  hasAddress: boolean;
  maskedPreview: string | null;
}

export type EbayEnvironment = 'SANDBOX' | 'PRODUCTION';

// eBay接続状態（設定タブ用）。Sandbox/Productionを同時に接続可能で、
// activeEnvが実際の出品(/api/publish-ebay)・価格調査に使われる環境
export interface EbayStatus {
  activeEnv: EbayEnvironment;
  sandbox: { connected: boolean; ebayUsername: string | null };
  production: { connected: boolean; ebayUsername: string | null };
}

export interface RecentListing {
  id: string;
  title: string;
  price: number;
  status: 'ACTIVE' | 'SOLD' | 'DRAFT' | 'CANCELLED';
  date: string;
  imageUrl?: string;
  category: string;
}

// 出品詳細画面用（最近の出品一覧をタップした際に取得する全項目）。
// canManage=falseは、offer_idが保存されていない（在庫数変更/キャンセル機能の追加より前に出品された）
// 出品のため、アプリからは在庫数変更・キャンセルができないことを示す
export interface ListingDetail extends RecentListing {
  description: string;
  aspects: Record<string, string[]>;
  quantity: number;
  format: 'FIXED_PRICE' | 'AUCTION';
  canManage: boolean;
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
