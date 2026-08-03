import type { ProductData } from '../types/listing';
import { isAspectRequired } from '../utils/productAspects';

interface Step4PreviewProps {
  productData: ProductData;
  onBack: () => void;
  onPublish: () => void;
}

const AUCTION_DURATION_LABEL: Record<string, string> = {
  DAYS_1: '1日間',
  DAYS_3: '3日間',
  DAYS_5: '5日間',
  DAYS_7: '7日間',
  DAYS_10: '10日間',
};

// Step 4: 最終確認・出品実行
export default function Step4_Preview({ productData, onBack, onPublish }: Step4PreviewProps) {
  const overallScore = productData.analysis?.overallScore;
  const isAuction = productData.pricing.format === 'AUCTION';
  const missingRequiredAspects = productData.aspects.filter(
    (a) => isAspectRequired(productData.categoryAspectDefs, a.key) && !a.value.trim()
  );
  const canPublish = missingRequiredAspects.length === 0;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-700">最終確認</h2>
      {productData.imageUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {productData.imageUrls.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`商品写真 ${i + 1}`}
              className="w-24 h-24 flex-shrink-0 object-cover rounded-lg border border-slate-200"
            />
          ))}
        </div>
      )}
      <div className="border border-slate-200 p-3 rounded-lg space-y-2 bg-slate-50 text-xs">
        <p>
          <span className="font-bold">タイトル:</span> {productData.title}
        </p>
        <p>
          <span className="font-bold">カテゴリー:</span> {productData.categoryName || '未選択'}
        </p>
        <p>
          <span className="font-bold">商品状態:</span> {productData.condition}
        </p>
        <p>
          <span className="font-bold">在庫数:</span> {productData.quantity}
        </p>
        {isAuction && productData.pricing.auction ? (
          <>
            <p>
              <span className="font-bold">販売方法:</span> オークション（
              {AUCTION_DURATION_LABEL[productData.pricing.auction.duration]}）
            </p>
            <p>
              <span className="font-bold">開始価格:</span> ${productData.pricing.auction.startingBid}
              {productData.pricing.auction.reservePrice !== undefined &&
                `（最低落札価格 $${productData.pricing.auction.reservePrice}）`}
            </p>
          </>
        ) : (
          <p>
            <span className="font-bold">価格:</span> ${productData.pricing.suggestedPrice}
          </p>
        )}
        {overallScore !== undefined && (
          <p>
            <span className="font-bold">出品準備スコア:</span> {overallScore}/100
          </p>
        )}
        {productData.aspects.length > 0 && (
          <div>
            <span className="font-bold">商品仕様:</span>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {productData.aspects.map((a, i) => (
                <p key={`${a.key}-${i}`} className="text-[10px] text-slate-500 truncate">
                  {a.key}: {a.value || '（未入力）'}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {!canPublish && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-[11px] text-red-600 font-bold">
          必須の商品仕様が未入力です: {missingRequiredAspects.map((a) => a.key).join(', ')}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
          戻る
        </button>
        <button
          onClick={onPublish}
          disabled={!canPublish}
          className="w-1/2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-extrabold py-3 rounded-lg shadow hover:from-emerald-700 hover:to-emerald-600 transition text-xs disabled:opacity-50"
        >
          eBayに出品を確定する
        </button>
      </div>
    </div>
  );
}
