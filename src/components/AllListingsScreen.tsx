import { useEffect, useState } from 'react';
import { Search, ArrowLeft } from 'lucide-react';
import { searchListings } from '../services/listingService';
import type { RecentListing } from '../types/app';

interface AllListingsScreenProps {
  onClose: () => void;
  onSelectListing: (id: string) => void;
}

// ホームの「すべて見る」から開く、全出品からタイトル・カテゴリで検索できる画面。
// 入力のたびに叩くと連打で無駄なリクエストが飛ぶため、300ms待ってから検索する（デバウンス）。
export default function AllListingsScreen({ onClose, onSelectListing }: AllListingsScreenProps) {
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<RecentListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchListings(query);
        if (!cancelled) setListings(results);
      } catch (err) {
        console.error('出品検索に失敗しました', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <header className="flex items-center gap-3 p-4 border-b border-slate-200 bg-white">
        <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-sm font-extrabold text-slate-800">すべての出品</h1>
      </header>

      <div className="p-4 pb-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="キーワードやカテゴリで検索"
            className="w-full border border-slate-200 bg-white rounded-lg pl-9 pr-3 py-2.5 text-base focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
        {isLoading ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-white border border-slate-200 rounded-xl p-3 h-14" />
          ))
        ) : listings.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-10">
            {query ? '該当する出品が見つかりませんでした' : 'まだ出品がありません'}
          </p>
        ) : (
          listings.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectListing(item.id)}
              className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 flex justify-between items-center shadow-sm hover:border-blue-200 hover:shadow-md transition"
            >
              <div className="space-y-1 max-w-[200px]">
                <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    {item.category}
                  </span>
                  <p className="text-[10px] text-slate-400">{item.date}</p>
                </div>
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
  );
}
