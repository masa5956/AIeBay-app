import { useEffect, useRef, useState } from 'react';
import {
  deleteShippingAddress,
  disconnectEbay,
  getEbayAuthUrl,
  getEbayStatus,
  getShippingAddressStatus,
  revealShippingAddress,
  saveShippingAddress,
  setActiveEbayEnv,
} from '../services/listingService';
import type { EbayEnvironment, EbayStatus, ShippingAddress, ShippingAddressStatus } from '../types/app';
import ReauthPasswordModal from './ReauthPasswordModal';
import ConfirmDialog from './ConfirmDialog';

interface SettingsPanelProps {
  useMockAnalysis: boolean;
  onToggleMockAnalysis: (value: boolean) => void;
  onLogout: () => void;
}

const ENV_LABEL: Record<EbayEnvironment, string> = { SANDBOX: 'サンドボックス', PRODUCTION: '本番' };

const EMPTY_ADDRESS: ShippingAddress = {
  addressLine1: '',
  city: '',
  stateOrProvince: '',
  postalCode: '',
  country: 'JP',
};

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
  // 解除も同様に確認を挟む（壊れた接続情報のクリア用途のため、誤操作で本当に必要な接続を
  // 消してしまわないようにする）
  const [confirmingDisconnectEnv, setConfirmingDisconnectEnv] = useState<EbayEnvironment | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  // 自動リトライの試行回数（再レンダーを起こす必要が無いのでrefで管理）
  const retryCountRef = useRef(0);

  // 出荷元住所（ユーザーごと、バックエンドでAES-256-GCM暗号化して保存）。「eBayでログイン」の前に必須。
  // デフォルトはマスクされた状態(addressStatus.hasAddress/maskedPreviewのみ)で、平文はパスワード再認証
  // (isAddressRevealed=true)を経ないと取得しない——UIのマスクだけでなくAPI境界自体でのアクセス制御。
  const [addressStatus, setAddressStatus] = useState<ShippingAddressStatus | null>(null);
  const [addressLoaded, setAddressLoaded] = useState(false);
  const [isAddressRevealed, setIsAddressRevealed] = useState(false);
  const [addressForm, setAddressForm] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [isDeletingAddress, setIsDeletingAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [addressSaved, setAddressSaved] = useState(false);
  const [isRevealModalOpen, setIsRevealModalOpen] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');

  const refreshAddressStatus = () => {
    getShippingAddressStatus()
      .then(setAddressStatus)
      .finally(() => setAddressLoaded(true));
  };

  useEffect(() => {
    refreshAddressStatus();
  }, []);

  const handleRevealAddress = async (password: string) => {
    setIsRevealing(true);
    setRevealError('');
    try {
      const data = await revealShippingAddress(password);
      setAddressForm(data || EMPTY_ADDRESS);
      setIsAddressRevealed(true);
      setIsRevealModalOpen(false);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : 'パスワードの確認に失敗しました');
    } finally {
      setIsRevealing(false);
    }
  };

  const handleSaveAddress = async () => {
    setIsSavingAddress(true);
    setAddressError('');
    setAddressSaved(false);
    try {
      await saveShippingAddress(addressForm);
      setAddressSaved(true);
      refreshAddressStatus();
    } catch (err) {
      setAddressError(err instanceof Error ? err.message : '出荷元住所の保存に失敗しました');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleDeleteAddress = async () => {
    setIsDeletingAddress(true);
    setAddressError('');
    setAddressSaved(false);
    try {
      await deleteShippingAddress();
      setAddressForm(EMPTY_ADDRESS);
      setIsAddressRevealed(false);
      refreshAddressStatus();
    } catch (err) {
      setAddressError(err instanceof Error ? err.message : '出荷元住所の削除に失敗しました');
    } finally {
      setIsDeletingAddress(false);
    }
  };

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
      // フルサイズの新規タブではなく、小さめのポップアップウィンドウとして開く
      // （幅・高さを指定すると多くのブラウザはタブではなく別ウィンドウとして開く。
      // eBayのログイン画面自体はiframeでの埋め込みを許可していない＝クリックジャッキング対策で
      // X-Frame-Options等により拒否されるため、アプリ内モーダルへの完全な埋め込みはできない）。
      // 完了後は/api/ebay/callbackがポップアップ側を処理し、このタブへフォーカスが戻った時点で
      // 上のfocusリスナーが最新状態を再取得する。同じ名前(ebayLogin)を指定することで、
      // 連打してもポップアップが増殖せず既存の1枚にフォーカスされるようにする。
      const popupWidth = 480;
      const popupHeight = 720;
      const left = window.screenX + Math.max(0, (window.outerWidth - popupWidth) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - popupHeight) / 2);
      window.open(
        url,
        'ebayLogin',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},noopener,noreferrer`
      );
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

  const handleDisconnectEbay = async (environment: EbayEnvironment) => {
    setConfirmingDisconnectEnv(null);
    setIsDisconnecting(true);
    setActionError('');
    try {
      await disconnectEbay(environment);
      refreshStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'eBay連携の解除に失敗しました');
    } finally {
      setIsDisconnecting(false);
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

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
        <h2 className="text-xs font-bold text-slate-700">出荷元住所</h2>
        <p className="text-slate-400 text-[10px]">
          「eBayでログイン」時にこの住所でご自身のeBayアカウント上に出荷元ロケーションが作成されます。
          ユーザーごとに個別に暗号化して保存され、表示・編集にはパスワードの再入力が必要です。
        </p>

        {!isAddressRevealed ? (
          <>
            {addressStatus?.hasAddress ? (
              <p className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-500">
                •••• {addressStatus.maskedPreview}
              </p>
            ) : (
              addressLoaded && (
                <p className="text-amber-600 text-[10px] font-bold">
                  未保存です。eBayに接続する前に住所を保存してください。
                </p>
              )
            )}
            <button
              onClick={() => setIsRevealModalOpen(true)}
              className="w-full bg-slate-800 text-white font-bold py-2.5 rounded-lg hover:bg-slate-900 transition"
            >
              {addressStatus?.hasAddress ? '表示/編集する' : '住所を入力する'}
            </button>
          </>
        ) : (
          <>
            <input
              value={addressForm.addressLine1}
              onChange={(e) => setAddressForm({ ...addressForm, addressLine1: e.target.value })}
              placeholder="住所1行目（番地・建物名など）"
              className="w-full border border-slate-200 rounded-lg px-3 py-2"
            />
            <div className="flex gap-2">
              <input
                value={addressForm.city}
                onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                placeholder="市区町村"
                className="w-1/2 border border-slate-200 rounded-lg px-3 py-2"
              />
              <input
                value={addressForm.stateOrProvince}
                onChange={(e) => setAddressForm({ ...addressForm, stateOrProvince: e.target.value })}
                placeholder="都道府県（任意）"
                className="w-1/2 border border-slate-200 rounded-lg px-3 py-2"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={addressForm.postalCode}
                onChange={(e) => setAddressForm({ ...addressForm, postalCode: e.target.value })}
                placeholder="郵便番号"
                className="w-1/2 border border-slate-200 rounded-lg px-3 py-2"
              />
              <input
                value={addressForm.country}
                onChange={(e) => setAddressForm({ ...addressForm, country: e.target.value })}
                placeholder="国コード（例: JP）"
                className="w-1/2 border border-slate-200 rounded-lg px-3 py-2"
              />
            </div>
            <button
              onClick={handleSaveAddress}
              disabled={isSavingAddress}
              className="w-full bg-slate-800 text-white font-bold py-2.5 rounded-lg hover:bg-slate-900 transition disabled:opacity-50"
            >
              {isSavingAddress ? '保存中...' : '住所を保存'}
            </button>
            {addressStatus?.hasAddress && (
              <button
                onClick={handleDeleteAddress}
                disabled={isDeletingAddress}
                className="w-full border border-red-200 text-red-600 font-bold py-2 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
              >
                {isDeletingAddress ? '削除中...' : '保存した住所を削除'}
              </button>
            )}
            <button
              onClick={() => setIsAddressRevealed(false)}
              className="w-full border border-slate-200 text-slate-500 font-bold py-2 rounded-lg hover:bg-slate-50 transition"
            >
              閉じる（再度マスク表示に戻す）
            </button>
          </>
        )}
        {addressError && <p className="text-red-500 text-[10px]">{addressError}</p>}
        {addressSaved && !addressError && <p className="text-emerald-600 text-[10px]">保存しました</p>}
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

          {/* Sandbox/Production切替時にこのボタンの有無で高さが変わり、下のボタン群がガクッと動いて
              「ちらつく」ように見えていたため、常に同じ高さの枠を確保し中身だけ出し分ける */}
          <div className="min-h-[42px]">
            {selectedInfo?.connected && !isActiveEnv && (
              <button
                onClick={() => setConfirmingSwitchEnv(selectedEnv)}
                disabled={isSwitching}
                className="w-full bg-emerald-600 text-white font-bold py-2.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {isSwitching ? '切替中...' : `${ENV_LABEL[selectedEnv]}に切り替える`}
              </button>
            )}
          </div>

          <button
            onClick={handleConnectEbay}
            disabled={isConnecting || !addressStatus?.hasAddress}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-2.5 rounded-lg hover:from-blue-700 hover:to-blue-600 transition disabled:opacity-50"
          >
            {isConnecting
              ? '接続中...'
              : selectedInfo?.connected
                ? '別のeBayアカウントでログインし直す'
                : `eBayでログイン（${ENV_LABEL[selectedEnv]}）`}
          </button>
          {!addressStatus?.hasAddress && addressLoaded && (
            <p className="text-amber-600 text-[10px]">上の「出荷元住所」を先に保存してください。</p>
          )}
          {selectedInfo?.connected && (
            <button
              onClick={() => setConfirmingDisconnectEnv(selectedEnv)}
              disabled={isDisconnecting}
              className="w-full border border-red-200 text-red-600 font-bold py-2 rounded-lg text-xs hover:bg-red-50 transition disabled:opacity-50"
            >
              {isDisconnecting ? '解除中...' : `${ENV_LABEL[selectedEnv]}のeBay連携を解除する`}
            </button>
          )}
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

      <ConfirmDialog
        open={!!confirmingDisconnectEnv}
        title={confirmingDisconnectEnv ? `${ENV_LABEL[confirmingDisconnectEnv]}のeBay連携を解除しますか？` : ''}
        body="再度出品するには「eBayでログイン」からやり直しが必要です。壊れた接続情報をクリアしたい場合にも使えます。"
        confirmLabel="解除する"
        onDismiss={() => setConfirmingDisconnectEnv(null)}
        onConfirm={() => confirmingDisconnectEnv && handleDisconnectEbay(confirmingDisconnectEnv)}
      />

      <ReauthPasswordModal
        open={isRevealModalOpen}
        isSubmitting={isRevealing}
        error={revealError}
        onDismiss={() => {
          setIsRevealModalOpen(false);
          setRevealError('');
        }}
        onSubmit={handleRevealAddress}
      />
    </div>
  );
}
