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
