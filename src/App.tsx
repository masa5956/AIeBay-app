import React, { lazy, Suspense, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { TabType, RecentListing, SalesSummary } from './types/app';
import type { ProductData } from './types/listing';
import { analyzeImageWithAI, getListings, mockAnalyzeImage, publishToEbay } from './services/listingService';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';
import AuthScreen from './components/AuthScreen';
import BottomNav from './components/BottomNav';
import Toast, { type Feedback } from './components/Toast';
import CancelConfirmDialog from './components/CancelConfirmDialog';
import StepperHeader from './components/StepperHeader';
import HomeDashboard from './components/HomeDashboard';
import AllListingsScreen from './components/AllListingsScreen';
import SettingsPanel from './components/SettingsPanel';
import Step1_ImageUpload from './components/Step1_ImageUpload';
import Step2_MetadataEdit from './components/Step2_MetadataEdit';
import Step3_Pricing from './components/Step3_Pricing';
import Step4_Preview from './components/Step4_Preview';
import ResearchPanel from './components/ResearchPanel';

// rechartsを含み重いため、分析タブを開くまでJSを読み込まない（初期バンドルサイズ削減）
const AnalyticsPanel = lazy(() => import('./components/AnalyticsPanel'));
// 最近の出品をタップするまで使わないため遅延読み込みする
const ListingDetailModal = lazy(() => import('./components/ListingDetailModal'));

export default function App() {
  // アプリ自体のログインセッション（Supabase Auth）。未ログイン時はAuthScreenを表示する。
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ナビゲーション状態
  const [activeTab, setActiveTab] = useState<TabType>('home');
  // 出品フロー実行中かどうか
  const [isListingMode, setIsListingMode] = useState<boolean>(false);

  // 出品ステッパー用状態
  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('');
  const [productData, setProductData] = useState<ProductData | null>(null);
  // 現在の出品案に使っている元画像ファイル一式（追加撮影時に再解析するため保持しておく）
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const MAX_PHOTOS = 8; // /api/analyze-imageのMAX_ANALYZE_IMAGESと合わせる
  // 完了・失敗トースト通知
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // 出品作業キャンセルの確認ダイアログ表示中かどうか
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState<boolean>(false);
  // 最近の出品からタップして詳細モーダルを開いている出品のID（未選択時はnull）
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  // ホームの「すべて見る」から開く、全出品検索画面を表示中かどうか
  const [showAllListings, setShowAllListings] = useState<boolean>(false);
  // 開発者向け: ONの間はAI解析をモックデータで代用しGemini/Groqのクォータを消費しない（出品自体は実APIを使用）
  const [useMockAnalysis, setUseMockAnalysis] = useState<boolean>(
    () => localStorage.getItem('ebay-ai-lister-use-mock-analysis') === 'true'
  );
  const handleToggleMockAnalysis = (value: boolean) => {
    setUseMockAnalysis(value);
    localStorage.setItem('ebay-ai-lister-use-mock-analysis', String(value));
  };

  // トースト通知を一定時間後に自動で閉じる
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(timer);
  }, [feedback]);

  // 売上サマリー・最近の出品（バックエンド/DBから取得。取得できるまでは空表示）
  const [salesSummary, setSalesSummary] = useState<SalesSummary>({
    totalRevenue: 0,
    monthlyRevenue: 0,
    monthlyRevenueChangePercent: null,
    activeListingsCount: 0,
    soldItemsCount: 0,
  });
  const [recentListings, setRecentListings] = useState<RecentListing[]>([]);
  // trueの間はHomeDashboardがスケルトン表示になる（0件/$0の初期値がAPIレスポンスで
  // 実データに差し替わる瞬間のちらつきを防ぐため）
  const [isListingsLoading, setIsListingsLoading] = useState<boolean>(true);

  const refreshListings = async () => {
    try {
      const data = await getListings();
      setSalesSummary(data.salesSummary);
      setRecentListings(data.recentListings);
    } catch (err) {
      // ホーム表示の初期取得失敗は致命的ではないため、トーストは出さず静かに諦める
      console.error('出品履歴の取得に失敗しました', err);
    } finally {
      setIsListingsLoading(false);
    }
  };

  // ログイン確定後に一度、最近の出品・売上サマリーを取得
  useEffect(() => {
    if (session) refreshListings();
  }, [session]);

  // 画像一式(files)でAI解析を実行し、結果をproductDataに反映する共通処理。
  // 初回の撮影・アップロード時と、Step2からの追加撮影時の両方から呼ばれる
  // （追加撮影時はexisting+newの全画像を毎回渡し、AIに1つの商品情報として再構成させる）。
  const runAnalysis = async (files: File[]) => {
    setIsLoading(true);
    setLoadingText(
      files.length > 1 ? `AIが${files.length}枚の画像から文字・属性を抽出中...` : 'AIが画像から文字・属性を抽出中...'
    );
    try {
      const result = useMockAnalysis ? await mockAnalyzeImage(files) : await analyzeImageWithAI(files);
      setSelectedFiles(files);
      setProductData(result);
      setStep(2);
    } catch (err) {
      setFeedback({ type: 'error', message: 'AI解析に失敗しました' });
    } finally {
      setIsLoading(false);
    }
  };

  // Step2: 「追加で撮影/アップロードする」— 既存の写真に追加し、全画像で再解析する
  const handleAddPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (newFiles.length === 0) return;
    const combined = [...selectedFiles, ...newFiles].slice(0, MAX_PHOTOS);
    if (combined.length >= MAX_PHOTOS && selectedFiles.length + newFiles.length > MAX_PHOTOS) {
      setFeedback({ type: 'error', message: `写真は最大${MAX_PHOTOS}枚までです。超過分は追加されませんでした` });
    }
    runAnalysis(combined);
  };

  // ステップ間を移動する（解析結果が無いうちはStep2以降へは移動できない）
  const goToStep = (targetStep: number) => {
    if (isLoading) return;
    if (targetStep > 1 && !productData) return;
    setStep(targetStep);
  };

  // 商品仕様(Item Specifics)の値を更新する
  const updateAspectValue = (index: number, value: string) => {
    if (!productData) return;
    const updatedAspects = [...productData.aspects];
    updatedAspects[index] = { ...updatedAspects[index], value };
    setProductData({ ...productData, aspects: updatedAspects });
  };

  // 出品処理
  const handlePublish = async () => {
    if (!productData) return;
    setIsLoading(true);
    setLoadingText('eBayに出品データを送信中...');
    try {
      const result = await publishToEbay(productData);
      if (result.success) {
        setFeedback({ type: 'success', message: `出品が完了しました（Listing ID: ${result.listingId}）` });

        await refreshListings();

        setIsListingMode(false);
        setStep(1);
        setProductData(null);
        setSelectedFiles([]);
      }
    } catch (err) {
      setFeedback({ type: 'error', message: '出品処理に失敗しました' });
    } finally {
      setIsLoading(false);
    }
  };

  const cancelListing = () => {
    setIsCancelConfirmOpen(false);
    setIsListingMode(false);
    setStep(1);
    setProductData(null);
    setSelectedFiles([]);
  };

// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEYが未設定のまま本番ビルドされた場合、
  // 真っ白な画面のまま原因が分からなくなるのを防ぐため、明確な案内を表示する。
  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen min-h-dvh bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl p-5 max-w-sm text-center space-y-2">
          <p className="text-sm font-bold text-red-600">アプリの設定が未完了です</p>
          <p className="text-xs text-slate-500">
            環境変数 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません。デプロイ先（Vercel）の
            環境変数を設定した上で、再デプロイしてください。
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen min-h-dvh bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-screen min-h-dvh bg-slate-900 text-slate-100 flex flex-col items-center">
      {/* スマホ画面枠。h-screen/h-dvhで高さをビューポートに固定し中身では伸ばさない
          （min-h-*のままだと出品数が増えるほど枠自体が縦に伸び、absolute配置のBottomNavが
          その分下へ押し出されてしまっていたため）。中身のスクロールはmain/ウィザード側の
          overflow-y-autoに任せ、枠自体はoverflow-hiddenでページ全体のスクロールを防ぐ */}
      <div className="w-full max-w-md bg-slate-50 text-slate-800 h-screen h-dvh flex flex-col relative shadow-2xl overflow-hidden">
        <Toast feedback={feedback} onClose={() => setFeedback(null)} />
        <CancelConfirmDialog
          open={isCancelConfirmOpen}
          onDismiss={() => setIsCancelConfirmOpen(false)}
          onConfirm={cancelListing}
        />
        {selectedListingId && (
          <Suspense fallback={null}>
            <ListingDetailModal listingId={selectedListingId} onClose={() => setSelectedListingId(null)} />
          </Suspense>
        )}

        {/* ================= 出品フローモーダル表示時 ================= */}
        {isListingMode ? (
          <div className="p-5 space-y-6 flex-1 bg-white overflow-y-auto">
            <header className="flex justify-between items-center border-b pb-3">
              <button
                onClick={() => setIsCancelConfirmOpen(true)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                ✕ 閉じる
              </button>
              <h1 className="text-base font-extrabold text-slate-800">eBay 自動出品ウィザード</h1>
              <div className="w-8"></div>
            </header>

            <StepperHeader step={step} hasProductData={!!productData} onGoToStep={goToStep} />

            {isLoading && (
              <div className="text-center py-16 space-y-3">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto"></div>
                <p className="text-sm font-semibold text-slate-600">{loadingText}</p>
              </div>
            )}

            {!isLoading && step === 1 && <Step1_ImageUpload onConfirm={runAnalysis} maxPhotos={MAX_PHOTOS} />}

            {!isLoading && step === 2 && productData && (
              <Step2_MetadataEdit
                productData={productData}
                onChange={setProductData}
                onUpdateAspect={updateAspectValue}
                onAddPhotos={handleAddPhotos}
                canAddMorePhotos={selectedFiles.length < MAX_PHOTOS}
                onBack={() => goToStep(1)}
                onNext={() => setStep(3)}
              />
            )}

            {!isLoading && step === 3 && productData && (
              <Step3_Pricing
                productData={productData}
                onChange={setProductData}
                onBack={() => goToStep(2)}
                onNext={() => goToStep(4)}
              />
            )}

            {!isLoading && step === 4 && productData && (
              <Step4_Preview productData={productData} onBack={() => goToStep(3)} onPublish={handlePublish} />
            )}
          </div>
        ) : showAllListings ? (
          <AllListingsScreen onClose={() => setShowAllListings(false)} onSelectListing={setSelectedListingId} />
        ) : (
          /* ================= 通常メイン画面（タブ切り替え） ================= */
          <main className="p-4 space-y-6 flex-1 overflow-y-auto pb-20">
            {activeTab === 'home' && (
              <HomeDashboard
                salesSummary={salesSummary}
                recentListings={recentListings}
                isLoading={isListingsLoading}
                onStartListing={() => setIsListingMode(true)}
                onSelectListing={setSelectedListingId}
                onViewAllListings={() => setShowAllListings(true)}
              />
            )}
            {activeTab === 'research' && <ResearchPanel />}
            {activeTab === 'analytics' && (
              <Suspense
                fallback={
                  <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
                  </div>
                }
              >
                <AnalyticsPanel />
              </Suspense>
            )}
            {activeTab === 'settings' && (
              <SettingsPanel
                useMockAnalysis={useMockAnalysis}
                onToggleMockAnalysis={handleToggleMockAnalysis}
                onLogout={() => supabase.auth.signOut()}
              />
            )}
          </main>
        )}

        {!isListingMode && !showAllListings && <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />}
      </div>
    </div>
  );
}
