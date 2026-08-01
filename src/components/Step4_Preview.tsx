import type { ProductData } from '../types/listing';

interface Step4PreviewProps {
  productData: ProductData;
  onBack: () => void;
  onPublish: () => void;
}

// Step 4: 最終確認・出品実行
export default function Step4_Preview({ productData, onBack, onPublish }: Step4PreviewProps) {
  const overallScore = productData.analysis?.overallScore;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-700">最終確認</h2>
      {productData.imageUrl && (
        <img
          src={productData.imageUrl}
          alt="Preview"
          className="w-full h-36 object-cover rounded-lg border border-slate-200"
        />
      )}
      <div className="border border-slate-200 p-3 rounded-lg space-y-2 bg-slate-50 text-xs">
        <p>
          <span className="font-bold">タイトル:</span> {productData.title}
        </p>
        <p>
          <span className="font-bold">価格:</span> ${productData.pricing.suggestedPrice}
        </p>
        {overallScore !== undefined && (
          <p>
            <span className="font-bold">出品準備スコア:</span> {overallScore}/100
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
          戻る
        </button>
        <button
          onClick={onPublish}
          className="w-1/2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-extrabold py-3 rounded-lg shadow hover:from-emerald-700 hover:to-emerald-600 transition text-xs"
        >
          eBayに出品を確定する
        </button>
      </div>
    </div>
  );
}
