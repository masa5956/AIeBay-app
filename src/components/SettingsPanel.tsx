import { useEffect, useState } from 'react';
import { getEbayAuthUrl, getEbayStatus } from '../services/listingService';

interface SettingsPanelProps {
  useMockAnalysis: boolean;
  onToggleMockAnalysis: (value: boolean) => void;
}

// 設定タブ: 連携状態の表示 + 開発者向けモック切替
export default function SettingsPanel({ useMockAnalysis, onToggleMockAnalysis }: SettingsPanelProps) {
  const [ebayConnected, setEbayConnected] = useState<boolean | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  useEffect(() => {
    getEbayStatus()
      .then((data) => setEbayConnected(data.connected))
      .catch(() => setEbayConnected(false));
  }, []);

  const handleConnectEbay = async () => {
    setIsConnecting(true);
    setConnectError('');
    try {
      const url = await getEbayAuthUrl();
      // eBayの同意画面へ遷移し、完了後は/api/ebay/callbackが処理する
      window.location.href = url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'eBay認証URLの取得に失敗しました');
      setIsConnecting(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-base font-bold text-slate-800">アカウント設定</h1>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
        <div className="flex justify-between items-center py-2 border-b">
          <span>eBay連携状態</span>
          {ebayConnected === null ? (
            <span className="text-slate-400">確認中...</span>
          ) : ebayConnected ? (
            <span className="text-emerald-600 font-bold">接続中</span>
          ) : (
            <span className="text-red-500 font-bold">未接続</span>
          )}
        </div>
        <div className="flex justify-between items-center py-2 border-b">
          <span>AIエンジン</span>
          <span className="text-slate-600 font-bold">Gemini 3.6 Flash (VLM)</span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span>デフォルト通貨</span>
          <span className="text-slate-600 font-bold">USD ($)</span>
        </div>
      </div>

      {ebayConnected !== null && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs shadow-sm">
          <button
            onClick={handleConnectEbay}
            disabled={isConnecting}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-2.5 rounded-lg hover:from-blue-700 hover:to-blue-600 transition disabled:opacity-50"
          >
            {isConnecting ? '接続中...' : ebayConnected ? '別のeBayアカウントでログインし直す' : 'eBayでログイン'}
          </button>
          {connectError && <p className="text-red-500 text-[10px]">{connectError}</p>}
          <p className="text-slate-400 text-[10px]">
            ログインすると、eBayの同意画面でログインしたアカウントで出品されるようになります。
          </p>
        </div>
      )}

      <h2 className="text-xs font-bold text-slate-500 pt-2">開発者向け設定</h2>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs shadow-sm">
        <div className="flex justify-between items-center py-1">
          <span>AI解析をモックデータで代用</span>
          <div className="flex rounded-full border border-slate-200 overflow-hidden">
            <button
              onClick={() => onToggleMockAnalysis(true)}
              className={`px-3 py-1 font-bold transition-colors ${
                useMockAnalysis ? 'bg-amber-500 text-white' : 'bg-white text-slate-500'
              }`}
            >
              ON
            </button>
            <button
              onClick={() => onToggleMockAnalysis(false)}
              className={`px-3 py-1 font-bold transition-colors ${
                !useMockAnalysis ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
              }`}
            >
              OFF
            </button>
          </div>
        </div>
        <p className="text-slate-400">
          ONにするとAI(Gemini/Groq)を呼び出さずサンプルデータで画面確認できます。eBayへの出品自体は実際のAPIを使用します。
        </p>
      </div>
    </div>
  );
}
