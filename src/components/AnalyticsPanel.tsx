import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useLanguage } from '../i18n/LanguageContext';

// ダミーの売上推移データ（過去6ヶ月）
const revenueTrend = [
  { month: 'Mar', revenue: 1850 },
  { month: 'Apr', revenue: 2100 },
  { month: 'May', revenue: 1980 },
  { month: 'Jun', revenue: 2450 },
  { month: 'Jul', revenue: 2890 },
  { month: 'Aug', revenue: 3200 },
];

// ダミーのカテゴリ別売上データ
const categoryBreakdown = [
  { category: 'Electronics', revenue: 4200 },
  { category: 'Gaming', revenue: 2600 },
  { category: 'Audio', revenue: 1800 },
  { category: 'Accessories', revenue: 900 },
];

// 分析タブ: 売上推移・カテゴリ別売上のグラフ表示
export default function AnalyticsPanel() {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-base font-bold text-slate-800">{t('analyticsTitle')}</h1>
        <p className="text-xs text-slate-400 mt-0.5">{t('analyticsSubtitle')}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-600 mb-2">{t('analyticsRevenueTrend')}</h3>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={revenueTrend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} />
            <Tooltip formatter={(value: number) => [`$${value}`, '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} fill="url(#revenueGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h3 className="text-xs font-bold text-slate-600 mb-2">{t('analyticsCategoryBreakdown')}</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={categoryBreakdown} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="category" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} />
            <Tooltip formatter={(value: number) => [`$${value}`, '']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
