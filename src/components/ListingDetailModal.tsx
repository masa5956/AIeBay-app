import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getListingDetail } from '../services/listingService';
import type { ListingDetail } from '../types/app';

interface ListingDetailModalProps {
  listingId: string;
  onClose: () => void;
}

// 最近の出品一覧からタップした1件の詳細（写真・説明文・商品仕様）を表示するモーダル
export default function ListingDetailModal({ listingId, onClose }: ListingDetailModalProps) {
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');
    getListingDetail(listingId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '出品詳細の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  return (
    <div className="absolute inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-xl">
        <div className="flex justify-between items-center p-4 border-b sticky top-0 bg-white">
          <h2 className="text-sm font-bold text-slate-800">出品詳細</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {isLoading && <p className="text-xs text-slate-400 text-center py-10">読み込み中...</p>}
          {error && <p className="text-xs text-red-500 text-center py-10">{error}</p>}

          {detail && (
            <>
              {detail.imageUrl && (
                <img
                  src={detail.imageUrl}
                  alt={detail.title}
                  className="w-full h-48 object-cover rounded-lg border border-slate-200"
                />
              )}

              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-800">{detail.title}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-slate-900">${detail.price}</span>
                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      detail.status === 'ACTIVE' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {detail.status}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">
                  {detail.date} ・ {detail.category}
                </p>
              </div>

              {detail.description && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-1">商品説明</h4>
                  <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{detail.description}</p>
                </div>
              )}

              {detail.aspects && Object.keys(detail.aspects).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-1">商品仕様 (Item Specifics)</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(detail.aspects).map(([key, values]) => (
                      <div key={key} className="bg-slate-50 rounded-lg p-2">
                        <p className="text-[9px] text-slate-400">{key}</p>
                        <p className="text-[11px] font-semibold text-slate-700">
                          {Array.isArray(values) ? values.join(', ') : String(values)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
