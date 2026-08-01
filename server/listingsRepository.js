import { supabase } from './supabaseClient.js';

// 出品成功時にlistingsテーブルへ1件保存する
export async function saveListing({ sku, listingId, title, price, imageUrl, category, description, aspects }) {
  if (!supabase) return; // Supabase未設定時は履歴保存をスキップ（出品自体は成功させる）
  const { error } = await supabase.from('listings').insert({
    sku,
    listing_id: listingId,
    title,
    price,
    status: 'ACTIVE',
    image_url: imageUrl || null,
    category: category || 'Other',
    description: description || null,
    aspects: aspects || null,
  });
  if (error) throw error;
}

// 出品詳細画面向け: listing_idを指定して1件分の全カラムを取得する
export async function getListingByListingId(listingId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('listings').select('*').eq('listing_id', listingId).maybeSingle();
  if (error) throw error;
  return data;
}

// 最近の出品一覧を新しい順に取得する
export async function getRecentListings(limit = 20) {
  if (!supabase) return []; // Supabase未設定時は空一覧を返す
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// 売上サマリーを集計する。
// 注意: 現状「売却済み(SOLD)」へのステータス更新の仕組みが無いため、
// 全出品はACTIVEのまま記録され続ける。そのためtotalRevenue/monthlyRevenue/
// soldItemsCountは現時点では常に0になる（将来的に売却検知の仕組みを追加した際に
// 意味を持つよう、集計ロジックだけ先に用意している）。
export async function getSalesSummary() {
  const empty = {
    totalRevenue: 0,
    monthlyRevenue: 0,
    monthlyRevenueChangePercent: null,
    activeListingsCount: 0,
    soldItemsCount: 0,
  };
  if (!supabase) return empty; // Supabase未設定時はゼロ集計を返す

  const { data, error } = await supabase.from('listings').select('price, status, created_at');
  if (error) throw error;

  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let totalRevenue = 0;
  let monthlyRevenue = 0;
  let previousMonthRevenue = 0;
  let activeListingsCount = 0;
  let soldItemsCount = 0;

  for (const row of data) {
    const price = Number(row.price) || 0;
    if (row.status === 'SOLD') {
      totalRevenue += price;
      soldItemsCount += 1;
      const createdAt = new Date(row.created_at);
      if (createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear()) {
        monthlyRevenue += price;
      } else if (
        createdAt.getMonth() === prevMonthDate.getMonth() &&
        createdAt.getFullYear() === prevMonthDate.getFullYear()
      ) {
        previousMonthRevenue += price;
      }
    } else if (row.status === 'ACTIVE') {
      activeListingsCount += 1;
    }
  }

  // 先月の売上が0の場合は変化率が定義できない（0除算・無限大になるため）ためnullを返し、
  // フロントエンド側でバッジ自体を非表示にする
  const monthlyRevenueChangePercent =
    previousMonthRevenue > 0 ? ((monthlyRevenue - previousMonthRevenue) / previousMonthRevenue) * 100 : null;

  return { totalRevenue, monthlyRevenue, monthlyRevenueChangePercent, activeListingsCount, soldItemsCount };
}

// 分析タブ向け: 月別出品額推移(直近6ヶ月)・カテゴリ別出品額構成を集計する。
// 注意: 売却済みかどうかを問わず「出品された時点の金額」を集計している
// （売却検知の仕組みが無いため、実際の売上ではなく出品アクティビティの実データ）。
export async function getAnalytics() {
  const empty = { monthlyTrend: [], categoryBreakdown: [] };
  if (!supabase) return empty;

  const { data, error } = await supabase.from('listings').select('price, category, created_at');
  if (error) throw error;

  // 直近6ヶ月分の枠を先に用意しておく（出品が無い月も0件で表示するため）
  const now = new Date();
  const monthlyMap = new Map();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(key, 0);
  }

  const categoryMap = new Map();

  for (const row of data) {
    const price = Number(row.price) || 0;
    const createdAt = new Date(row.created_at);
    const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, monthlyMap.get(monthKey) + price);
    }

    const category = row.category || 'Other';
    categoryMap.set(category, (categoryMap.get(category) || 0) + price);
  }

  const monthlyTrend = Array.from(monthlyMap.entries()).map(([month, value]) => ({ month, value }));
  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return { monthlyTrend, categoryBreakdown };
}
