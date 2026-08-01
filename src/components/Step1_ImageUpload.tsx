import { Camera } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import type { Platform } from '../types/listing';

interface Step1ImageUploadProps {
  platform: Platform;
  onChangePlatform: (platform: Platform) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Step 1: 出品先選択 + 商品写真の撮影・選択
export default function Step1_ImageUpload({ platform, onChangePlatform, onUpload }: Step1ImageUploadProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 text-center py-6">
      <div className="space-y-1.5">
        <p className="text-xs font-bold text-slate-500">{t('platformSelectLabel')}</p>
        <div className="inline-flex rounded-full border border-slate-200 overflow-hidden">
          <button
            onClick={() => onChangePlatform('ebay')}
            className={`px-4 py-1.5 text-xs font-bold transition-colors ${
              platform === 'ebay' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
            }`}
          >
            eBay
          </button>
          <button
            onClick={() => onChangePlatform('mercari')}
            className={`px-4 py-1.5 text-xs font-bold transition-colors ${
              platform === 'mercari' ? 'bg-red-500 text-white' : 'bg-white text-slate-500'
            }`}
          >
            {t('platformMercari')}
          </button>
        </div>
        {platform === 'mercari' && <p className="text-[10px] text-slate-400 px-4">{t('platformMercariNote')}</p>}
      </div>

      <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 bg-slate-50 space-y-4">
        <Camera size={40} className="mx-auto text-slate-400" />
        <p className="text-xs text-slate-500">{t('step1Instruction')}</p>
        <input type="file" accept="image/*" onChange={onUpload} className="hidden" id="camera-input-wizard" />
        <label
          htmlFor="camera-input-wizard"
          className="cursor-pointer bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg shadow hover:from-blue-700 hover:to-blue-600 transition block text-sm"
        >
          {t('step1Button')}
        </label>
      </div>
    </div>
  );
}
