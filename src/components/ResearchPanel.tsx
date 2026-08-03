import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Plus, Search, X } from 'lucide-react';
import type { ResearchArticle, ResearchCategoryDef } from '../types/app';
import { searchResearchArticles } from '../services/listingService';

// アプリ標準の固定カテゴリ（削除不可）。カテゴリを増やしたい場合はここに1件追加するだけでよい
// （バックエンドはキーワード検索のみを行い、カテゴリという概念自体はフロントエンドの表示上のラベル付け）。
const DEFAULT_CATEGORIES: ResearchCategoryDef[] = [
  { key: 'cosmetics', label: 'コスメ', query: 'コスメ 新作 OR 新色 OR 新発売', isCustom: false },
  { key: 'games', label: 'ゲーム', query: 'ゲーム 発売 OR 新作', isCustom: false },
  { key: 'gadgets', label: 'ガジェット', query: 'ガジェット 新製品 OR 新発売', isCustom: false },
];

const CUSTOM_CATEGORIES_STORAGE_KEY = 'ebay-ai-lister-research-custom-categories';

function loadCustomCategories(): ResearchCategoryDef[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ResearchCategoryDef[]) : [];
  } catch {
    return [];
  }
}

function saveCustomCategories(categories: ResearchCategoryDef[]) {
  localStorage.setItem(CUSTOM_CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
}

// リサーチタブ: 固定カテゴリ + ユーザーが自由検索から追加できるカテゴリ（localStorageに永続化）。
// カテゴリ選択・自由検索のどちらも同じ検索APIを叩くので、カテゴリの実体は「ラベル付きの検索クエリ」。
// 記事をタップすると実際の記事URLへ新規タブで遷移する。
export default function ResearchPanel() {
  const [customCategories, setCustomCategories] = useState<ResearchCategoryDef[]>(() => loadCustomCategories());
  const [activeCategoryKey, setActiveCategoryKey] = useState<string>('cosmetics');
  const [searchInput, setSearchInput] = useState('');
  // null以外の間は自由検索モード（カテゴリ選択と排他）
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [articles, setArticles] = useState<ResearchArticle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const allCategories = useMemo(() => [...DEFAULT_CATEGORIES, ...customCategories], [customCategories]);
  const activeCategory = allCategories.find((c) => c.key === activeCategoryKey);
  const isAlreadySavedAsCategory = activeSearch
    ? customCategories.some((c) => c.query === activeSearch)
    : false;

  useEffect(() => {
    const query = activeSearch ?? activeCategory?.query;
    if (!query) return;

    let cancelled = false;
    setIsLoading(true);
    setError('');
    searchResearchArticles(query)
      .then((data) => {
        if (!cancelled) setArticles(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '記事の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryKey, activeSearch]);

  const handleSelectCategory = (key: string) => {
    setActiveCategoryKey(key);
    setActiveSearch(null);
    setSearchInput('');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) return;
    setActiveCategoryKey('');
    setActiveSearch(trimmed);
  };

  const handleAddCustomCategory = () => {
    if (!activeSearch || isAlreadySavedAsCategory) return;
    const label = activeSearch.length > 10 ? `${activeSearch.slice(0, 10)}…` : activeSearch;
    const newCategory: ResearchCategoryDef = {
      key: `custom-${Date.now()}`,
      label,
      query: activeSearch,
      isCustom: true,
    };
    const updated = [...customCategories, newCategory];
    setCustomCategories(updated);
    saveCustomCategories(updated);
    setActiveSearch(null);
    setActiveCategoryKey(newCategory.key);
  };

  const handleRemoveCustomCategory = (key: string) => {
    const updated = customCategories.filter((c) => c.key !== key);
    setCustomCategories(updated);
    saveCustomCategories(updated);
    if (activeCategoryKey === key) {
      setActiveCategoryKey('cosmetics');
    }
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
        {allCategories.map((cat) => (
          <div key={cat.key} className="relative shrink-0">
            <button
              onClick={() => handleSelectCategory(cat.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
                activeCategoryKey === cat.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              } ${cat.isCustom ? 'pr-5' : ''}`}
            >
              {cat.label}
            </button>
            {cat.isCustom && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveCustomCategory(cat.key);
                }}
                className="absolute top-0.5 right-0.5 text-slate-400 hover:text-red-500"
                aria-label={`${cat.label}を削除`}
              >
                <X size={10} />
              </button>
            )}
          </div>
        ))}
      </div>

      {activeSearch && (
        <div className="flex justify-between items-center">
          <p className="text-xs text-slate-500">
            「<span className="font-bold">{activeSearch}</span>」の検索結果
          </p>
          {!isAlreadySavedAsCategory && (
            <button
              onClick={handleAddCustomCategory}
              className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-0.5 shrink-0"
            >
              <Plus size={10} /> カテゴリに追加
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-blue-600" size={28} />
          </div>
        ) : error ? (
          <p className="text-xs text-red-500 text-center py-8 whitespace-pre-wrap">{error}</p>
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
