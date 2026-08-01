import { supabase } from './supabaseClient.js';

// 出品成功時にlistingsテーブルへ1件保存する
export async function saveListing({ sku, listingId, title, price, imageUrl }) {
  const { error } = await supabase.from('listings').insert({
    sku,
    listing_id: listingId,
    title,
    price,
    status: 'ACTIVE',
    image_url: imageUrl || null,
  });
  if (error) throw error;
}

// 最近の出品一覧を新しい順に取得する
export async function getRecentListings(limit = 20) {
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
  const { data, error } = await supabase.from('listings').select('price, status, created_at');
  if (error) throw error;

  const now = new Date();
  let totalRevenue = 0;
  let monthlyRevenue = 0;
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
      }
    } else if (row.status === 'ACTIVE') {
      activeListingsCount += 1;
    }
  }

  return { totalRevenue, monthlyRevenue, activeListingsCount, soldItemsCount };
}
