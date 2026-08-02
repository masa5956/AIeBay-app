import { Plus } from 'lucide-react';
import type { ProductData } from '../types/listing';

interface Step2MetadataEditProps {
  productData: ProductData;
  onChange: (data: ProductData) => void;
  onUpdateAspect: (index: number, value: string) => void;
  onAddPhotos: (e: React.ChangeEvent<HTMLInputElement>) => void;
  canAddMorePhotos: boolean;
  onBack: () => void;
  onNext: () => void;
}

function scoreColorClasses(score: number) {
  if (score >= 85) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (score >= 60) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

// Step 2: AI解析結果（タイトル・ブランド・型番・説明・商品仕様・状態評価）の確認と補正
export default function Step2_MetadataEdit({
  productData,
  onChange,
  onUpdateAspect,
  onAddPhotos,
  canAddMorePhotos,
  onBack,
  onNext,
}: Step2MetadataEditProps) {
  const condition = productData.analysis?.conditionAssessment;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-700">AI解析情報の補正</h2>

      {/* 撮影済み写真一覧 + 追加撮影。写真を追加すると全画像でAIが再解析し、タイトル/説明文/仕様を再構成する */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {productData.imageUrls.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`商品写真 ${i + 1}`}
            className="w-20 h-20 flex-shrink-0 object-cover rounded-lg border border-slate-200"
          />
        ))}
        {canAddMorePhotos && (
          <label
            htmlFor="add-photos-input"
            className="w-20 h-20 flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 cursor-pointer hover:border-blue-400 hover:text-blue-500 transition"
          >
            <Plus size={18} />
            <span className="text-[9px] font-bold">追加</span>
          </label>
        )}
        <input
          id="add-photos-input"
          type="file"
          accept="image/*"
          multiple
          onChange={onAddPhotos}
          className="hidden"
        />
      </div>
      <p className="text-[10px] text-slate-400 -mt-2">
        写真を追加すると、全ての写真の情報をもとにAIがタイトル・説明文・商品仕様を再構成します
      </p>

      {/* AIによる商品状態評価 */}
      {condition && (
        <div className={`border rounded-lg p-3 space-y-1.5 ${scoreColorClasses(condition.conditionScore)}`}>
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase">AIによる商品状態評価</span>
            <span className="text-xs font-black">
              {condition.conditionLabel} ({condition.conditionScore}/100)
            </span>
          </div>
          <p className="text-[11px] leading-relaxed">
            {condition.defects.length > 0 ? condition.defects.join(' / ') : '目立った欠陥は検出されませんでした'}
          </p>
          {condition.notes && <p className="text-[10px] opacity-80">{condition.notes}</p>}
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-slate-500">タイトル (Max 80文字)</label>
        <input
          type="text"
          value={productData.title}
          maxLength={80}
          onChange={(e) => onChange({ ...productData, title: e.target.value })}
          className="w-full border border-slate-200 p-2 rounded-lg text-base mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <span className="text-[10px] text-slate-400 block text-right">{productData.title.length}/80文字</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-slate-500">ブランド</label>
          <input
            type="text"
            value={productData.brand}
            onChange={(e) => onChange({ ...productData, brand: e.target.value })}
            className="w-full border border-slate-200 p-2 rounded-lg text-base mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500">型番</label>
          <input
            type="text"
            value={productData.model}
            onChange={(e) => onChange({ ...productData, model: e.target.value })}
            className="w-full border border-slate-200 p-2 rounded-lg text-base mt-1"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-500">商品説明</label>
        <textarea
          value={productData.description}
          onChange={(e) => onChange({ ...productData, description: e.target.value })}
          rows={8}
          className="w-full border border-slate-200 p-2 rounded-lg text-base mt-1 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
        />
      </div>

      {/* 商品仕様 (Item Specifics) */}
      {productData.aspects.length > 2 && (
        <div>
          <label className="text-xs font-semibold text-slate-500">商品仕様 (Item Specifics)</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {productData.aspects.slice(2).map((aspect, i) => (
              <div key={aspect.key}>
                <label className="text-[10px] text-slate-400">{aspect.key}</label>
                <input
                  type="text"
                  value={aspect.value}
                  onChange={(e) => onUpdateAspect(i + 2, e.target.value)}
                  className="w-full border border-slate-200 p-2 rounded-lg text-base mt-1"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
          戻る
        </button>
        <button
          onClick={onNext}
          className="w-1/2 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-3 rounded-lg hover:from-blue-700 hover:to-blue-600 transition text-xs"
        >
          価格調整へ進む
        </button>
      </div>
    </div>
  );
}
