import { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getAnalytics } from '../services/listingService';
import type { AnalyticsData } from '../types/app';

// 分析タブ: 実際の出品データ(DB)に基づく出品額推移・カテゴリ別出品額のグラフ表示
export default function AnalyticsPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getAnalytics();
        if (!cancelled) setAnalytics(data);
      } catch (err) {
        console.error('分析データの取得に失敗しました', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasMonthlyData = !!analytics?.monthlyTrend.some((point) => point.value > 0);
  const hasCategoryData = !!analytics && analytics.categoryBreakdown.length > 0;

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-base font-bold text-slate-800">販売統計分析</h1>
        <p className="text-xs text-slate-400 mt-0.5">出品額推移とカテゴリ別の出品傾向</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-600 mb-2">出品額推移（過去6ヶ月）</h3>
        {isLoading ? (
          <p className="text-xs text-slate-400 py-10 text-center">データを読み込み中...</p>
        ) : hasMonthlyData ? (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={analytics!.monthlyTrend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} fill="url(#revenueGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-slate-400 py-10 text-center">まだ出品データがありません。出品するとここに表示されます。</p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-600 mb-2">カテゴリ別出品額構成</h3>
        {isLoading ? (
          <p className="text-xs text-slate-400 py-10 text-center">データを読み込み中...</p>
        ) : hasCategoryData ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={analytics!.categoryBreakdown} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="category" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-slate-400 py-10 text-center">まだ出品データがありません。出品するとここに表示されます。</p>
        )}
      </div>

      <p className="text-[10px] text-slate-400 text-center">
        実際の出品データに基づく集計です（売却済みかどうかは反映されません）
      </p>
    </div>
  );
}
