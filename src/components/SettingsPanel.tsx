import { useLanguage } from '../i18n/LanguageContext';

interface SettingsPanelProps {
  useMockAnalysis: boolean;
  onToggleMockAnalysis: (value: boolean) => void;
}

// 設定タブ: 連携状態の表示 + 表示言語の切替 + 開発者向けモック切替
export default function SettingsPanel({ useMockAnalysis, onToggleMockAnalysis }: SettingsPanelProps) {
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

      <h2 className="text-xs font-bold text-slate-500 pt-2">{t('settingsDevSection')}</h2>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs shadow-sm">
        <div className="flex justify-between items-center py-1">
          <span>{t('settingsMockAnalysis')}</span>
          <div className="flex rounded-full border border-slate-200 overflow-hidden">
            <button
              onClick={() => onToggleMockAnalysis(true)}
              className={`px-3 py-1 font-bold transition-colors ${
                useMockAnalysis ? 'bg-amber-500 text-white' : 'bg-white text-slate-500'
              }`}
            >
              {t('mockModeOn')}
            </button>
            <button
              onClick={() => onToggleMockAnalysis(false)}
              className={`px-3 py-1 font-bold transition-colors ${
                !useMockAnalysis ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
              }`}
            >
              {t('mockModeOff')}
            </button>
          </div>
        </div>
        <p className="text-slate-400">{t('settingsMockAnalysisDesc')}</p>
      </div>
    </div>
  );
}
