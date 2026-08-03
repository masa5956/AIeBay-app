import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { ResearchArticle, ResearchCategory } from '../types/app';
import { getResearchArticles } from '../services/listingService';

const CATEGORIES: { key: ResearchCategory; label: string }[] = [
  { key: 'cosmetics', label: 'コスメ' },
  { key: 'games', label: 'ゲーム' },
  { key: 'gadgets', label: 'ガジェット' },
];

// リサーチタブ: カテゴリ別の最新記事一覧（RSSフィードベース、AI呼び出しなし）。
// 記事をタップすると実際の記事URLへ新規タブで遷移する。
export default function ResearchPanel() {
  const [category, setCategory] = useState<ResearchCategory>('cosmetics');
  const [articles, setArticles] = useState<ResearchArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');
    getResearchArticles(category)
      .then((data) => {
        if (!cancelled) setArticles(data);
      })
      .catch(() => {
        if (!cancelled) setError('記事の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  return (
    <div className="space-y-4">
      <div className="pt-2">
        <h1 className="text-lg font-black text-slate-800">リサーチ</h1>
        <p className="text-xs text-slate-400 mt-0.5">カテゴリ別の最新ニュースをチェックできます</p>
      </div>

      <div className="flex gap-2">
        {CATEGORIES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
              category === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-blue-600" size={28} />
          </div>
        ) : error ? (
          <p className="text-xs text-red-500 text-center py-8">{error}</p>
        ) : articles.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">記事が見つかりませんでした</p>
        ) : (
          articles.map((article, i) => (
            <a
              key={`${article.link}-${i}`}
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-blue-200 hover:shadow-md transition"
            >
              <p className="text-xs font-bold text-slate-800 leading-snug">{article.title}</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-[10px] text-slate-400">{article.source}</span>
                <span className="text-[10px] text-blue-500 font-semibold flex items-center gap-1">
                  記事を見る <ExternalLink size={10} />
                </span>
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
