import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { useLanguage } from '../i18n/LanguageContext';
import { compareGenres } from '../services/listingService';
import type { GenreComparisonResult } from '../types/app';

// 分析タブ内: 出品検討中の複数ジャンルを、eBay Browse APIの現在の出品状況から比較するツール
export default function GenreComparisonPanel() {
  const { t } = useLanguage();
  const [input, setInput] = useState<string>('');
  const [results, setResults] = useState<GenreComparisonResult[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleCompare = async () => {
    const genres = input
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    if (genres.length < 2 || genres.length > 6) {
      setError(t('genreComparisonDesc'));
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const data = await compareGenres(genres);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div>
        <h3 className="text-xs font-bold text-slate-600">{t('genreComparisonTitle')}</h3>
        <p className="text-[10px] text-slate-400 mt-0.5">{t('genreComparisonDesc')}</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('genreComparisonInputPlaceholder')}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleCompare}
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg disabled:opacity-50"
        >
          {isLoading ? t('genreComparisonComparing') : t('genreComparisonButton')}
        </button>
      </div>

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {results && results.length > 0 && (
        <div className="space-y-3">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={results} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="genre" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip formatter={(value: number) => [value, t('genreComparisonScoreLabel')]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="demandScore" radius={[4, 4, 0, 0]}>
                {results.map((r, index) => (
                  <Cell key={r.genre} fill={index === 0 ? '#16a34a' : '#2563eb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="space-y-1.5">
            {results.map((r, index) => (
              <div
                key={r.genre}
                className={`flex justify-between items-center text-[10px] px-2.5 py-1.5 rounded-lg ${
                  index === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'
                }`}
              >
                <span className="font-bold">
                  {index === 0 && `🏆 ${t('genreComparisonRecommended')}: `}
                  {r.genre}
                </span>
                <span>
                  {t('genreComparisonScoreLabel')} {r.demandScore} ・ {t('genreComparisonListingCount')} {r.activeListingCount} ・{' '}
                  {t('genreComparisonAvgPrice')} ${r.avgPrice.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-400 text-center">{t('genreComparisonCaveat')}</p>
    </div>
  );
}
