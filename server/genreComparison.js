import axios from 'axios';
import { EBAY_BASE_URL, getAppAccessToken } from './ebayAuth.js';
import { removeOutliersByIQR } from './priceStats.js';

// 複数ジャンル(キーワード)についてeBay Browse APIで現在の出品状況を調べ、
// 出品数の少なさ(供給の少なさ)・価格の安定度から相対的な需要スコアを算出する。
// 注意: eBay Browse APIは「現在アクティブな出品」のみが対象であり、実際の売却実績データではない。
// あくまで「現時点の供給状況」からの推定である点をUI上にも明示すること。
export async function compareGenres(genres) {
  const appToken = await getAppAccessToken();

  const results = await Promise.all(
    genres.map(async (genre) => {
      const response = await axios.get(`${EBAY_BASE_URL}/buy/browse/v1/item_summary/search`, {
        headers: {
          Authorization: `Bearer ${appToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        params: { q: genre, limit: 50, filter: 'buyingOptions:{FIXED_PRICE}' },
      });

      const items = response.data.itemSummaries || [];
      // totalは検索条件に合致する全件数（limitで返る件数とは別）で、供給規模の指標として使う
      const activeListingCount = response.data.total ?? items.length;

      const prices = items
        .map((item) => parseFloat(item.price?.value || '0'))
        .filter((p) => p > 0)
        .sort((a, b) => a - b);

      if (prices.length === 0) {
        return { genre, activeListingCount, avgPrice: 0, minPrice: 0, maxPrice: 0, priceSpreadRatio: 1 };
      }

      const filtered = removeOutliersByIQR(prices);
      const avgPrice = filtered.reduce((sum, p) => sum + p, 0) / filtered.length;
      const minPrice = filtered[0];
      const maxPrice = filtered[filtered.length - 1];
      // 価格帯の広さを平均価格に対する比率で正規化（価格帯が狭い=相場が安定している）
      const priceSpreadRatio = avgPrice > 0 ? (maxPrice - minPrice) / avgPrice : 1;

      return { genre, activeListingCount, avgPrice, minPrice, maxPrice, priceSpreadRatio };
    })
  );

  // 需要スコア(0-100)は比較対象ジャンル間での相対評価(min-max正規化)。
  // 出品数が少ないほど・価格帯が安定しているほど高スコアになるようにする。
  const counts = results.map((r) => r.activeListingCount);
  const spreads = results.map((r) => r.priceSpreadRatio);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  const minSpread = Math.min(...spreads);
  const maxSpread = Math.max(...spreads);

  const scored = results.map((r) => {
    const countScore = maxCount === minCount ? 100 : 100 - ((r.activeListingCount - minCount) / (maxCount - minCount)) * 100;
    const spreadScore = maxSpread === minSpread ? 100 : 100 - ((r.priceSpreadRatio - minSpread) / (maxSpread - minSpread)) * 100;
    const demandScore = Math.round(countScore * 0.6 + spreadScore * 0.4);
    return { ...r, demandScore };
  });

  return scored.sort((a, b) => b.demandScore - a.demandScore);
}
