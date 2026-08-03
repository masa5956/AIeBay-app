import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { ProductData } from '../types/listing';
import { isAspectRequired } from '../utils/productAspects';

interface Step2MetadataEditProps {
  productData: ProductData;
  onChange: (data: ProductData) => void;
  onUpdateAspect: (index: number, value: string) => void;
  onAddAspect: (key: string, value: string) => void;
  onRemoveAspect: (index: number) => void;
  onSelectCategory: (categoryId: string, categoryName: string) => void;
  isFetchingCategoryAspects: boolean;
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
  onAddAspect,
  onRemoveAspect,
  onSelectCategory,
  isFetchingCategoryAspects,
  onAddPhotos,
  canAddMorePhotos,
  onBack,
  onNext,
}: Step2MetadataEditProps) {
  const condition = productData.analysis?.conditionAssessment;
  const [isAddingAspect, setIsAddingAspect] = useState(false);
  const [newAspectKey, setNewAspectKey] = useState('');
  const [newAspectValue, setNewAspectValue] = useState('');

  const handleConfirmAddAspect = () => {
    if (!newAspectKey.trim()) return;
    onAddAspect(newAspectKey, newAspectValue);
    setNewAspectKey('');
    setNewAspectValue('');
    setIsAddingAspect(false);
  };

  const missingRequiredCount = productData.aspects.filter(
    (a) => isAspectRequired(productData.categoryAspectDefs, a.key) && !a.value.trim()
  ).length;

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

      {/* eBayカテゴリー選択（Taxonomy APIの候補から選ぶ。誤選択が必須項目検証を壊すため自動確定しない） */}
      <div>
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-slate-500">eBayカテゴリー</label>
          {isFetchingCategoryAspects && (
            <span className="text-[9px] text-slate-400">必須項目を確認中...</span>
          )}
        </div>
        {productData.categoryId ? (
          <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mt-1">
            {productData.categoryName}
          </p>
        ) : (
          <p className="text-[10px] text-amber-600 mt-1">
            カテゴリー未選択です。下の候補から選択すると、必須の商品仕様を自動で確認できます。
          </p>
        )}
        {productData.categorySuggestions && productData.categorySuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {productData.categorySuggestions.map((s) => (
              <button
                key={s.categoryId}
                onClick={() => onSelectCategory(s.categoryId, s.categoryName)}
                disabled={isFetchingCategoryAspects}
                className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition disabled:opacity-50 ${
                  productData.categoryId === s.categoryId
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'
                }`}
              >
                {s.categoryName}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 商品仕様 (Item Specifics) */}
      <div>
        <div className="flex justify-between items-center">
          <label className="text-xs font-semibold text-slate-500">商品仕様 (Item Specifics)</label>
          {missingRequiredCount > 0 && (
            <span className="text-[9px] font-bold text-red-500">必須項目が{missingRequiredCount}件未入力です</span>
          )}
        </div>
        {productData.aspects.length > 2 && (
          <div className="grid grid-cols-2 gap-2 mt-1">
            {productData.aspects.slice(2).map((aspect, i) => {
              const index = i + 2;
              const required = isAspectRequired(productData.categoryAspectDefs, aspect.key);
              const isEmpty = required && !aspect.value.trim();
              return (
                <div key={`${aspect.key}-${index}`}>
                  <div className="flex justify-between items-center gap-1">
                    <label className="text-[10px] text-slate-400 truncate">
                      {aspect.key}
                      {required && <span className="text-red-500 font-bold"> *必須</span>}
                    </label>
                    {!required && (
                      <button
                        onClick={() => onRemoveAspect(index)}
                        className="text-slate-300 hover:text-red-500 flex-shrink-0"
                        aria-label={`${aspect.key}を削除`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={aspect.value}
                    onChange={(e) => onUpdateAspect(index, e.target.value)}
                    className={`w-full border p-2 rounded-lg text-base mt-1 ${
                      isEmpty ? 'border-red-300 bg-red-50' : 'border-slate-200'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}

        {isAddingAspect ? (
          <div className="mt-2 border border-slate-200 rounded-lg p-2 space-y-2 bg-slate-50">
            <input
              value={newAspectKey}
              onChange={(e) => setNewAspectKey(e.target.value)}
              placeholder="項目名（例: Style）"
              className="w-full border border-slate-200 p-2 rounded-lg text-sm"
            />
            <input
              value={newAspectValue}
              onChange={(e) => setNewAspectValue(e.target.value)}
              placeholder="値（例: Casual）"
              className="w-full border border-slate-200 p-2 rounded-lg text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setIsAddingAspect(false)}
                className="w-1/2 border py-1.5 rounded-lg text-[11px] font-bold text-slate-600"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmAddAspect}
                className="w-1/2 bg-blue-600 text-white py-1.5 rounded-lg text-[11px] font-bold"
              >
                追加する
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingAspect(true)}
            className="mt-2 flex items-center gap-1 text-[11px] font-bold text-blue-600"
          >
            <Plus size={14} /> 仕様を追加
          </button>
        )}
      </div>

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
