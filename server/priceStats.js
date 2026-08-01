// 四分位範囲(IQR)アルゴリズムによる外れ値除去。
// /api/estimate-price と /api/genre-comparison の両方で使う共通ロジック。
export function removeOutliersByIQR(sortedPrices) {
  const q1Index = Math.floor(sortedPrices.length * 0.25);
  const q3Index = Math.floor(sortedPrices.length * 0.75);
  const q1 = sortedPrices[q1Index];
  const q3 = sortedPrices[Math.min(q3Index, sortedPrices.length - 1)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const filtered = sortedPrices.filter((p) => p >= lowerBound && p <= upperBound);
  return filtered.length > 0 ? filtered : sortedPrices;
}
