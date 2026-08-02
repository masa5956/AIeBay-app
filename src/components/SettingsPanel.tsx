import { useEffect, useRef, useState } from 'react';
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
  // 接続状態の取得に失敗した場合のエラー（trueの間は「確認中...」のまま固まらないよう
  // エラー表示+再試行ボタンに切り替える。Renderの無料枠はスリープからの初回応答に
  // 30秒前後かかることがあるため、それを想定して自動リトライも数回行う）
  const [statusError, setStatusError] = useState(false);
  // タブをタップしただけで切り替わってしまう誤操作を防ぐため、実際の切替前に確認を挟む
  const [confirmingSwitchEnv, setConfirmingSwitchEnv] = useState<EbayEnvironment | null>(null);
  // 自動リトライの試行回数（再レンダーを起こす必要が無いのでrefで管理）
  const retryCountRef = useRef(0);

  const refreshStatus = () => {
    setStatusError(false);
    getEbayStatus()
      .then((data) => {
        retryCountRef.current = 0;
        setStatus(data);
        setSelectedEnv(data.activeEnv);
      })
      .catch(() => {
        setStatusError(true);
      });
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  // 取得に失敗した場合、バックエンドのコールドスタート等を想定して間隔を空けながら
  // 最大3回まで自動リトライする（3秒後→8秒後→15秒後）。それでも失敗したら手動の再試行に委ねる。
  useEffect(() => {
    if (!statusError || retryCountRef.current >= 3) return;
    const delay = [3000, 8000, 15000][retryCountRef.current];
    retryCountRef.current += 1;
    const timer = setTimeout(refreshStatus, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusError]);

  // eBayログイン用に新規タブを開いた後、そのタブでの操作完了後にこのタブへフォーカスが
  // 戻ったタイミングで接続状態を自動的に再取得する（新規タブ側でリロード等をしなくても
  // 設定タブの表示が最新化されるようにするため）
  useEffect(() => {
    const handleFocus = () => refreshStatus();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const selectedInfo = status ? (selectedEnv === 'SANDBOX' ? status.sandbox : status.production) : null;
  const isActiveEnv = status?.activeEnv === selectedEnv;

  const handleConnectEbay = async () => {
    setIsConnecting(true);
    setActionError('');
    try {
      const url = await getEbayAuthUrl(selectedEnv);
      // 新規タブでeBayの同意画面を開く（元のアプリタブはそのまま残す）。
      // 完了後は/api/ebay/callbackが新規タブ側を処理し、このタブへフォーカスが戻った時点で
      // 上のfocusリスナーが最新状態を再取得する。
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'eBay認証URLの取得に失敗しました');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSwitchEnv = async (environment: EbayEnvironment) => {
    setConfirmingSwitchEnv(null);
    setIsSwitching(true);
    setActionError('');
    try {
      await setActiveEbayEnv(environment);
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
          {status !== null ? (
            <span className="text-emerald-600 font-bold">{ENV_LABEL[status.activeEnv]}</span>
          ) : statusError ? (
            <button onClick={refreshStatus} className="text-red-500 font-bold hover:underline">
              取得に失敗しました（タップして再試行）
            </button>
          ) : (
            <span className="text-slate-400">確認中...</span>
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
              onClick={() => setConfirmingSwitchEnv(selectedEnv)}
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

      {confirmingSwitchEnv && (
        <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-4 shadow-xl text-center">
            <p className="text-sm font-bold text-slate-700">
              出品先を{ENV_LABEL[confirmingSwitchEnv]}に切り替えますか？
            </p>
            <p className="text-xs text-slate-400">
              以後、出品・価格調査は{ENV_LABEL[confirmingSwitchEnv]}環境のeBayアカウントに対して行われます。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingSwitchEnv(null)}
                className="w-1/2 border py-2 rounded-lg text-xs font-bold text-slate-600"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleSwitchEnv(confirmingSwitchEnv)}
                className="w-1/2 bg-emerald-600 text-white py-2 rounded-lg text-xs font-bold"
              >
                切り替える
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
