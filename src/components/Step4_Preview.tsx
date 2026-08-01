import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { ProductData } from '../types/listing';
import { useLanguage } from '../i18n/LanguageContext';

interface Step4PreviewProps {
  productData: ProductData;
  onBack: () => void;
  onPublish: () => void;
}

// コピー用フィールド1行（メルカリ手動出品向け）
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-slate-200 rounded-lg p-2.5 bg-white">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-bold text-slate-500">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '✓' : ''}
        </button>
      </div>
      <p className="text-xs text-slate-700 whitespace-pre-wrap break-words">{value}</p>
    </div>
  );
}

// Step 4: 最終確認・出品実行（eBay）または メルカリ向けコピー&手動出品案内
export default function Step4_Preview({ productData, onBack, onPublish }: Step4PreviewProps) {
  const { t } = useLanguage();
  const overallScore = productData.analysis?.overallScore;

  if (productData.platform === 'mercari') {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-700">{t('step4TitleMercari')}</h2>
        {productData.imageUrl && (
          <img
            src={productData.imageUrl}
            alt="Preview"
            className="w-full h-36 object-cover rounded-lg border border-slate-200"
          />
        )}
        <p className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          {t('mercariManualNote')}
        </p>

        <div className="space-y-2">
          <CopyField label={t('finalTitleLabel')} value={productData.title} />
          <CopyField label={t('finalPriceLabel')} value={`¥${productData.pricing.userPrice}`} />
          {productData.mercariCategorySuggestion && (
            <CopyField label={t('fieldMercariCategory')} value={productData.mercariCategorySuggestion} />
          )}
          {productData.mercariCondition && (
            <CopyField label={t('fieldMercariCondition')} value={productData.mercariCondition} />
          )}
          <CopyField label={t('fieldDescription')} value={productData.description} />
        </div>

        <div className="flex gap-2">
          <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
            {t('back')}
          </button>
          <button
            onClick={onPublish}
            className="w-1/2 bg-gradient-to-r from-red-600 to-red-500 text-white font-extrabold py-3 rounded-lg shadow hover:from-red-700 hover:to-red-600 transition text-xs"
          >
            {t('mercariCompleteButton')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-700">{t('step4Title')}</h2>
      {productData.imageUrl && (
        <img
          src={productData.imageUrl}
          alt="Preview"
          className="w-full h-36 object-cover rounded-lg border border-slate-200"
        />
      )}
      <div className="border border-slate-200 p-3 rounded-lg space-y-2 bg-slate-50 text-xs">
        <p>
          <span className="font-bold">{t('finalTitleLabel')}:</span> {productData.title}
        </p>
        <p>
          <span className="font-bold">{t('finalPriceLabel')}:</span> ${productData.pricing.suggestedPrice}
        </p>
        {overallScore !== undefined && (
          <p>
            <span className="font-bold">{t('finalScoreLabel')}:</span> {overallScore}/100
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onBack} className="w-1/2 border py-3 rounded-lg text-xs font-bold text-slate-600">
          {t('back')}
        </button>
        <button
          onClick={onPublish}
          className="w-1/2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-extrabold py-3 rounded-lg shadow hover:from-emerald-700 hover:to-emerald-600 transition text-xs"
        >
          {t('publishButton')}
        </button>
      </div>
    </div>
  );
}
