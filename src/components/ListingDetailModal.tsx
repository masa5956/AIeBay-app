import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cancelListing, getListingDetail, markListingSold, updateListingQuantity } from '../services/listingService';
import type { ListingDetail } from '../types/app';
import ConfirmDialog from './ConfirmDialog';

interface ListingDetailModalProps {
  listingId: string;
  onClose: () => void;
  onListingChanged?: () => void;
}

// 最近の出品一覧からタップした1件の詳細（写真・説明文・商品仕様）を表示するモーダル。
// status==='ACTIVE'かつcanManage(=offer_idが保存されている、つまりこの機能追加以降の出品)の場合のみ、
// 在庫数変更・キャンセル・売却済みマークができる
export default function ListingDetailModal({ listingId, onClose, onListingChanged }: ListingDetailModalProps) {
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantityInput, setQuantityInput] = useState('1');
  const [isSavingQuantity, setIsSavingQuantity] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isMarkingSold, setIsMarkingSold] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'cancel' | 'sold' | null>(null);
  const [actionError, setActionError] = useState('');

  const loadDetail = () => {
    setIsLoading(true);
    setError('');
    getListingDetail(listingId)
      .then((data) => {
        setDetail(data);
        setQuantityInput(String(data.quantity));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '出品詳細の取得に失敗しました');
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const handleSaveQuantity = async () => {
    const quantity = parseInt(quantityInput, 10);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) {
      setActionError('在庫数は0〜9999の整数で指定してください。');
      return;
    }
    setIsSavingQuantity(true);
    setActionError('');
    try {
      await updateListingQuantity(listingId, quantity);
      loadDetail();
      onListingChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '在庫数の変更に失敗しました');
    } finally {
      setIsSavingQuantity(false);
    }
  };

  const handleCancelListing = async () => {
    setConfirmAction(null);
    setIsCancelling(true);
    setActionError('');
    try {
      await cancelListing(listingId);
      loadDetail();
      onListingChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '出品キャンセルに失敗しました');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleMarkSold = async () => {
    setConfirmAction(null);
    setIsMarkingSold(true);
    setActionError('');
    try {
      await markListingSold(listingId);
      loadDetail();
      onListingChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '売却済みマークに失敗しました');
    } finally {
      setIsMarkingSold(false);
    }
  };

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

              {detail.status === 'ACTIVE' && detail.canManage && (
                <div className="border-t pt-3 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 mb-1">在庫数</h4>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        value={quantityInput}
                        onChange={(e) => setQuantityInput(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      />
                      <button
                        onClick={handleSaveQuantity}
                        disabled={isSavingQuantity}
                        className="px-4 bg-slate-800 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                      >
                        {isSavingQuantity ? '変更中...' : '変更'}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => setConfirmAction('sold')}
                    disabled={isMarkingSold}
                    className="w-full border border-emerald-200 text-emerald-700 font-bold py-2 rounded-lg text-xs hover:bg-emerald-50 transition disabled:opacity-50"
                  >
                    {isMarkingSold ? '処理中...' : '売却済みにする'}
                  </button>
                  <button
                    onClick={() => setConfirmAction('cancel')}
                    disabled={isCancelling}
                    className="w-full border border-red-200 text-red-600 font-bold py-2 rounded-lg text-xs hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {isCancelling ? '処理中...' : '出品をキャンセルする'}
                  </button>

                  {actionError && <p className="text-[10px] text-red-500">{actionError}</p>}
                </div>
              )}

              {detail.status === 'ACTIVE' && !detail.canManage && (
                <p className="text-[10px] text-slate-400 border-t pt-3">
                  この出品はこの機能の追加より前のため、アプリから在庫数変更・キャンセルはできません。eBay Seller Hubから操作してください。
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="この出品をキャンセルしますか？"
        body="eBay上の出品が終了します。取り消すことはできません。"
        confirmLabel="キャンセルする"
        onDismiss={() => setConfirmAction(null)}
        onConfirm={handleCancelListing}
      />
      <ConfirmDialog
        open={confirmAction === 'sold'}
        title="この出品を売却済みにしますか？"
        body="eBay側の出品状態は変更されません。アプリ内の記録のみ更新されます。"
        confirmLabel="売却済みにする"
        confirmClassName="bg-emerald-600"
        onDismiss={() => setConfirmAction(null)}
        onConfirm={handleMarkSold}
      />
    </div>
  );
}
