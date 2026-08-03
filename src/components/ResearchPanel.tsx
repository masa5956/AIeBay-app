import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import type { ResearchArticle, ResearchCategory } from '../types/app';
import { getResearchArticles, searchResearchArticles } from '../services/listingService';

const CATEGORIES: { key: ResearchCategory; label: string }[] = [
  { key: 'cosmetics', label: 'コスメ' },
  { key: 'games', label: 'ゲーム' },
  { key: 'gadgets', label: 'ガジェット' },
];

// リサーチタブ: カテゴリ別の最新記事一覧（RSSフィードベース、AI呼び出しなし）。
// 固定カテゴリボタンに加え、任意のキーワードでも検索できる（固定カテゴリにない
// キーワードはGoogleニュース検索RSS経由、searchResearchArticlesが対応）。
// 記事をタップすると実際の記事URLへ新規タブで遷移する。
export default function ResearchPanel() {
  // category !== null の間はカテゴリモード、search !== null の間は自由検索モード
  // （どちらか一方だけがアクティブになる）
  const [category, setCategory] = useState<ResearchCategory | null>('cosmetics');
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [articles, setArticles] = useState<ResearchArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');

    const request = activeSearch ? searchResearchArticles(activeSearch) : category ? getResearchArticles(category) : Promise.resolve([]);

    request
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
  }, [category, activeSearch]);

  const handleSelectCategory = (key: ResearchCategory) => {
    setCategory(key);
    setActiveSearch(null);
    setSearchInput('');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    setCategory(null);
    setActiveSearch(trimmed);
  };

  return (
    <div className="space-y-4">
      <div className="pt-2">
        <h1 className="text-lg font-black text-slate-800">リサーチ</h1>
        <p className="text-xs text-slate-400 mt-0.5">カテゴリ別、または任意のキーワードで最新ニュースをチェックできます</p>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="キーワードで検索（例: ニベア リップ 海外）"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 flex items-center justify-center transition"
        >
          <Search size={16} />
        </button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {CATEGORIES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleSelectCategory(key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition ${
              category === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSearch && (
        <p className="text-xs text-slate-500">
          「<span className="font-bold">{activeSearch}</span>」の検索結果
        </p>
      )}

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
