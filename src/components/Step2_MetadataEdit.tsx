import { MERCARI_CONDITIONS, type ProductData } from '../types/listing';
import { useLanguage } from '../i18n/LanguageContext';

interface Step2MetadataEditProps {
  productData: ProductData;
  onChange: (data: ProductData) => void;
  onUpdateAspect: (index: number, value: string) => void;
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
  onBack,
  onNext,
}: Step2MetadataEditProps) {
  const { t } = useLanguage();
  const condition = productData.analysis?.conditionAssessment;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-700">{t('step2Title')}</h2>
      {productData.imageUrl && (
        <img
          src={productData.imageUrl}
          alt="Preview"
          className="w-full h-36 object-cover rounded-lg border border-slate-200"
        />
      )}

      {/* AIによる商品状態評価 */}
      {condition && (
        <div className={`border rounded-lg p-3 space-y-1.5 ${scoreColorClasses(condition.conditionScore)}`}>
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase">{t('conditionAssessmentTitle')}</span>
            <span className="text-xs font-black">
              {condition.conditionLabel} ({condition.conditionScore}/100)
            </span>
          </div>
          <p className="text-[11px] leading-relaxed">
            {condition.defects.length > 0 ? condition.defects.join(' / ') : t('conditionDefectsNone')}
          </p>
          {condition.notes && <p className="text-[10px] opacity-80">{condition.notes}</p>}
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-slate-500">{t('fieldTitle')}</label>
        <input
          type="text"
          value={productData.title}
          maxLength={80}
          onChange={(e) => onChange({ ...productData, title: e.target.value })}
          className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <span className="text-[10px] text-slate-400 block text-right">
          {productData.title.length}/80{t('charCount')}
        </span>
      </div>

      {productData.platform === 'mercari' ? (
        <div>
          <label className="text-xs font-semibold text-slate-500">{t('fieldMercariCategory')}</label>
          <input
            type="text"
            value={productData.mercariCategorySuggestion || ''}
            onChange={(e) => onChange({ ...productData, mercariCategorySuggestion: e.target.value })}
            className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-slate-500">{t('fieldBrand')}</label>
            <input
              type="text"
              value={productData.brand}
              onChange={(e) => onChange({ ...productData, brand: e.target.value })}
              className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">{t('fieldModel')}</label>
            <input
              type="text"
              value={productData.model}
              onChange={(e) => onChange({ ...productData, model: e.target.value })}
              className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1"
            />
          </div>
        </div>
      )}

      {productData.platform === 'mercari' && (
        <div>
          <label className="text-xs font-semibold text-slate-500">{t('fieldMercariCondition')}</label>
          <select
            value={productData.mercariCondition || MERCARI_CONDITIONS[0]}
            onChange={(e) => onChange({ ...productData, mercariCondition: e.target.value as ProductData['mercariCondition'] })}
            className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1 bg-white"
          >
            {MERCARI_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-slate-500">{t('fieldDescription')}</label>
        <textarea
          value={productData.description}
          onChange={(e) => onChange({ ...productData, description: e.target.value })}
          rows={8}
          className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
        />
      </div>

      {/* 商品仕様 (Item Specifics) — eBayのみ */}
      {productData.platform === 'ebay' && productData.aspects.length > 2 && (
        <div>
          <label className="text-xs font-semibold text-slate-500">{t('fieldItemSpecifics')}</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {productData.aspects.slice(2).map((aspect, i) => (
              <div key={aspect.key}>
                <label className="text-[10px] text-slate-400">{aspect.key}</label>
                <input
                  type="text"
                  value={aspect.value}
                  onChange={(e) => onUpdateAspect(i + 2, e.target.value)}
                  className="w-full border border-slate-200 p-2 rounded-lg text-sm mt-1"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
          {t('back')}
        </button>
        <button
          onClick={onNext}
          className="w-1/2 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-3 rounded-lg hover:from-blue-700 hover:to-blue-600 transition text-xs"
        >
          {t('proceedToPricing')}
        </button>
      </div>
    </div>
  );
}
