import type { ProductData } from '../types/listing';

interface Step3PricingProps {
  productData: ProductData;
  onChange: (data: ProductData) => void;
  onBack: () => void;
  onNext: () => void;
}

function scoreColorClasses(score: number) {
  if (score >= 80) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (score >= 60) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function demandBadgeClasses(level?: 'High' | 'Medium' | 'Low') {
  if (level === 'High') return 'bg-emerald-100 text-emerald-700';
  if (level === 'Low') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

// Step 3: 価格調整 + AIマルチエージェント分析（市場トレンド・競合比較・総合スコア）の表示
export default function Step3_Pricing({ productData, onChange, onBack, onNext }: Step3PricingProps) {
  const { marketTrend, competitorSuggestions, overallScore, recommendation } = productData.analysis || {};

  const demandLabel =
    marketTrend?.demandLevel === 'High' ? '需要: 高' : marketTrend?.demandLevel === 'Low' ? '需要: 低' : '需要: 中';

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-700">価格調整・AI分析</h2>

      <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg space-y-1">
        <span className="text-[10px] font-bold text-blue-600 uppercase">AI適正査定額</span>
        <div className="text-2xl font-black text-blue-900">${productData.pricing.suggestedPrice}</div>
        <p className="text-[10px] text-slate-500">
          市場レンジ: ${productData.pricing.minPrice} - ${productData.pricing.maxPrice}
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-500">出品設定価格 ($USD)</label>
        <input
          type="number"
          step="0.01"
          value={productData.pricing.suggestedPrice}
          onChange={(e) =>
            onChange({
              ...productData,
              pricing: { ...productData.pricing, suggestedPrice: parseFloat(e.target.value) || 0 },
            })
          }
          className="w-full border border-slate-200 p-2 rounded-lg text-base mt-1 font-bold"
        />
      </div>

      {/* 総合判定スコア */}
      {overallScore !== undefined && (
        <div className={`border rounded-lg p-3 space-y-1 ${scoreColorClasses(overallScore)}`}>
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase">出品準備スコア</span>
            <span className="text-lg font-black">{overallScore}/100</span>
          </div>
          {recommendation && <p className="text-[11px]">{recommendation}</p>}
          <p className="text-[9px] opacity-70">AI解析時点の暫定スコアです（価格調整前）</p>
        </div>
      )}

      {/* 市場トレンド分析 */}
      {marketTrend && (
        <div className="border border-slate-200 rounded-lg p-3 space-y-1.5 bg-white">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase">市場トレンド分析</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${demandBadgeClasses(marketTrend.demandLevel)}`}>
              {demandLabel}
            </span>
          </div>
          <p className="text-[11px] text-slate-600">{marketTrend.trendNote}</p>
          <p className="text-[9px] text-slate-400">
            現在出品中の類似商品からの需要推定です（売却実績データではありません）
          </p>
        </div>
      )}

      {/* 競合比較提案 */}
      {competitorSuggestions && (
        <div className="border border-slate-200 rounded-lg p-3 space-y-1.5 bg-white">
          <span className="text-[10px] font-bold text-slate-500 uppercase">競合比較の提案</span>
          <ul className="list-disc list-inside space-y-1">
            {competitorSuggestions.suggestions.map((s, i) => (
              <li key={i} className="text-[11px] text-slate-600">
                {s}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-500">{competitorSuggestions.competitivePriceNote}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
          戻る
        </button>
        <button
          onClick={onNext}
          className="w-1/2 bg-gradient-to-r from-blue-600 to-blue-500 text-white py-3 rounded-lg text-xs font-bold hover:from-blue-700 hover:to-blue-600 transition"
        >
          最終確認へ
        </button>
      </div>
    </div>
  );
}
