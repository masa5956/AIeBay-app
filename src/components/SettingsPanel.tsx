import { useLanguage } from '../i18n/LanguageContext';

// 設定タブ: 連携状態の表示 + 表示言語の切替
export default function SettingsPanel() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-base font-bold text-slate-800">{t('settingsTitle')}</h1>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
        <div className="flex justify-between items-center py-2 border-b">
          <span>{t('settingsEbayStatus')}</span>
          <span className="text-emerald-600 font-bold">{t('settingsEbayConnected')}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b">
          <span>{t('settingsAiEngine')}</span>
          <span className="text-slate-600 font-bold">Gemini 3.6 Flash (VLM)</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b">
          <span>{t('settingsCurrency')}</span>
          <span className="text-slate-600 font-bold">USD ($)</span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span>{t('settingsLanguage')}</span>
          <div className="flex rounded-full border border-slate-200 overflow-hidden">
            <button
              onClick={() => setLanguage('ja')}
              className={`px-3 py-1 font-bold transition-colors ${
                language === 'ja' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
              }`}
            >
              日本語
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`px-3 py-1 font-bold transition-colors ${
                language === 'en' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
              }`}
            >
              English
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
