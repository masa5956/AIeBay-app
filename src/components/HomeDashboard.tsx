import { Camera } from 'lucide-react';
import type { RecentListing, SalesSummary } from '../types/app';

interface HomeDashboardProps {
  salesSummary: SalesSummary;
  recentListings: RecentListing[];
  isLoading: boolean;
  onStartListing: () => void;
  onSelectListing: (id: string) => void;
  onViewAllListings: () => void;
}

// ホームタブ: 売上ダッシュボード + 最近の出品一覧。
// isLoading中は「$0」「0件」等の初期値をそのまま表示してしまうと、直後にAPIの実データへ
// 差し替わる際にちらつく（フラッシュ・オブ・ゼロコンテンツ）ため、代わりにスケルトンを表示する。
export default function HomeDashboard({
  salesSummary,
  recentListings,
  isLoading,
  onStartListing,
  onSelectListing,
  onViewAllListings,
}: HomeDashboardProps) {
  return (
    <div className="space-y-6">
      {/* アプリヘッダー */}
      <div className="flex justify-between items-center pt-2">
        <div>
          <p className="text-xs font-semibold text-slate-400">ようこそ</p>
          <h1 className="text-lg font-black text-slate-800">eBay AI Lister</h1>
        </div>
      </div>

      {/* 売上ダッシュボード */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-5 text-white shadow-xl space-y-4">
        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="space-y-2">
              <div className="h-3 w-16 bg-slate-700/60 rounded" />
              <div className="h-8 w-28 bg-slate-700/60 rounded" />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/60">
              <div className="h-8 bg-slate-700/40 rounded" />
              <div className="h-8 bg-slate-700/40 rounded" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-slate-400 font-medium">今月の売上</p>
                <h2 className="text-3xl font-black mt-1 tracking-tight">
                  ${salesSummary.monthlyRevenue.toLocaleString()}
                </h2>
              </div>
              {salesSummary.monthlyRevenueChangePercent !== null && (
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
                    salesSummary.monthlyRevenueChangePercent >= 0
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-red-500/20 text-red-400 border-red-500/30'
                  }`}
                >
                  {salesSummary.monthlyRevenueChangePercent >= 0 ? '+' : ''}
                  {salesSummary.monthlyRevenueChangePercent.toFixed(1)}%
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/60 text-xs">
              <div>
                <p className="text-slate-400 text-[10px]">アクティブ出品中</p>
                <p className="font-bold text-slate-100 mt-0.5">{salesSummary.activeListingsCount} 件</p>
              </div>
              <div>
                <p className="text-slate-400 text-[10px]">累計販売実績</p>
                <p className="font-bold text-slate-100 mt-0.5">{salesSummary.soldItemsCount} 件</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 出品メインアクションボタン */}
      <button
        onClick={onStartListing}
        className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 active:scale-[0.98] text-white font-extrabold py-4 rounded-xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition"
      >
        <Camera size={20} />
        <span>写真から出品を作成する</span>
      </button>

      {/* 最近の出品リスト。出品数が増えても親(main)全体のスクロールに影響しないよう、
          このリスト自体の高さを画面の目安サイズに収めて内側でスクロールさせる */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-slate-800">最近の出品</h3>
          <button
            onClick={onViewAllListings}
            className="text-xs text-blue-600 font-semibold hover:underline"
          >
            すべて見る
          </button>
        </div>

        <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-0.5">
          {isLoading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse bg-white border border-slate-200 rounded-xl p-3 h-14" />
            ))
          ) : recentListings.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">まだ出品がありません</p>
          ) : (
            recentListings.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectListing(item.id)}
                className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 flex justify-between items-center shadow-sm hover:border-blue-200 hover:shadow-md transition"
              >
                <div className="space-y-1 max-w-[200px]">
                  <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                  <p className="text-[10px] text-slate-400">{item.date}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-slate-900">${item.price}</p>
                  <span
                    className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      item.status === 'ACTIVE' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
