import { useEffect, useState } from 'react';
import { getEbayAuthUrl, getEbayStatus, setActiveEbayEnv } from '../services/listingService';
import type { EbayEnvironment, EbayStatus } from '../types/app';

interface SettingsPanelProps {
  useMockAnalysis: boolean;
  onToggleMockAnalysis: (value: boolean) => void;
  onLogout: () => void;
}

const ENV_LABEL: Record<EbayEnvironment, string> = { SANDBOX: 'サンドボックス', PRODUCTION: '本番' };

// 設定タブ: eBay連携状態(Sandbox/Production切替) + 開発者向けモック切替
export default function SettingsPanel({ useMockAnalysis, onToggleMockAnalysis, onLogout }: SettingsPanelProps) {
  const [status, setStatus] = useState<EbayStatus | null>(null);
  // 「eBayでログイン」ボタンがどちらの環境を対象にするか（初期値はアクティブな環境）
  const [selectedEnv, setSelectedEnv] = useState<EbayEnvironment>('SANDBOX');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [actionError, setActionError] = useState('');

  const refreshStatus = () => {
    getEbayStatus().then((data) => {
      setStatus(data);
      setSelectedEnv(data.activeEnv);
    });
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const selectedInfo = status ? (selectedEnv === 'SANDBOX' ? status.sandbox : status.production) : null;
  const isActiveEnv = status?.activeEnv === selectedEnv;

  const handleConnectEbay = async () => {
    setIsConnecting(true);
    setActionError('');
    try {
      const url = await getEbayAuthUrl(selectedEnv);
      // eBayの同意画面へ遷移し、完了後は/api/ebay/callbackが処理する
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'eBay認証URLの取得に失敗しました');
      setIsConnecting(false);
    }
  };

  const handleSwitchEnv = async () => {
    setIsSwitching(true);
    setActionError('');
    try {
      await setActiveEbayEnv(selectedEnv);
      refreshStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'eBay環境の切替に失敗しました');
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-base font-bold text-slate-800">アカウント設定</h1>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
        <div className="flex justify-between items-center py-2 border-b">
          <span>現在の出品先</span>
          {status === null ? (
            <span className="text-slate-400">確認中...</span>
          ) : (
            <span className="text-emerald-600 font-bold">{ENV_LABEL[status.activeEnv]}</span>
          )}
        </div>
        <div className="flex justify-between items-center py-2">
          <span>AIエンジン</span>
          <span className="text-slate-600 font-bold">Gemini 3.6 Flash (VLM)</span>
        </div>
      </div>

      {status !== null && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
          <div className="flex rounded-full border border-slate-200 overflow-hidden">
            {(['SANDBOX', 'PRODUCTION'] as const).map((env) => (
              <button
                key={env}
                onClick={() => setSelectedEnv(env)}
                className={`flex-1 py-1.5 font-bold transition-colors ${
                  selectedEnv === env ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
                }`}
              >
                {ENV_LABEL[env]}
              </button>
            ))}
          </div>

          <div className="flex justify-between items-center py-1">
            <span>接続状態</span>
            {selectedInfo?.connected ? (
              <span className="text-emerald-600 font-bold">
                接続中{selectedInfo.ebayUsername ? `（${selectedInfo.ebayUsername}）` : ''}
              </span>
            ) : (
              <span className="text-red-500 font-bold">未接続</span>
            )}
          </div>

          {selectedInfo?.connected && !isActiveEnv && (
            <button
              onClick={handleSwitchEnv}
              disabled={isSwitching}
              className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {isSwitching ? '切替中...' : `${ENV_LABEL[selectedEnv]}に切り替える`}
            </button>
          )}

          <button
            onClick={handleConnectEbay}
            disabled={isConnecting}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-2.5 rounded-lg hover:from-blue-700 hover:to-blue-600 transition disabled:opacity-50"
          >
            {isConnecting
              ? '接続中...'
              : selectedInfo?.connected
                ? '別のeBayアカウントでログインし直す'
                : `eBayでログイン（${ENV_LABEL[selectedEnv]}）`}
          </button>
          {actionError && <p className="text-red-500 text-[10px]">{actionError}</p>}
          <p className="text-slate-400 text-[10px]">
            ログインすると、eBayの同意画面でログインしたアカウントで{ENV_LABEL[selectedEnv]}環境が接続され、
            自動的に出品先として切り替わります。
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

      <button
        onClick={onLogout}
        className="w-full border border-red-200 text-red-600 font-bold py-2.5 rounded-lg text-xs hover:bg-red-50 transition"
      >
        ログアウト
      </button>
    </div>
  );
}
