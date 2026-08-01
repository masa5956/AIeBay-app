import { Camera } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface Step1ImageUploadProps {
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Step 1: 商品写真の撮影・選択
export default function Step1_ImageUpload({ onUpload }: Step1ImageUploadProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 text-center py-6">
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
