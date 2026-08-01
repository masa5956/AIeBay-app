import React, { useEffect, useState } from 'react';
import type { TabType, RecentListing, SalesSummary } from './types/app';
import type { ProductData } from './types/listing';
import { analyzeImageWithAI, getListings, mockAnalyzeImage, publishToEbay } from './services/listingService';
import BottomNav from './components/BottomNav';
import Toast, { type Feedback } from './components/Toast';
import CancelConfirmDialog from './components/CancelConfirmDialog';
import StepperHeader from './components/StepperHeader';
import HomeDashboard from './components/HomeDashboard';
import AnalyticsPanel from './components/AnalyticsPanel';
import SettingsPanel from './components/SettingsPanel';
import Step1_ImageUpload from './components/Step1_ImageUpload';
import Step2_MetadataEdit from './components/Step2_MetadataEdit';
import Step3_Pricing from './components/Step3_Pricing';
import Step4_Preview from './components/Step4_Preview';
import ListingDetailModal from './components/ListingDetailModal';

export default function App() {
  // ナビゲーション状態
  const [activeTab, setActiveTab] = useState<TabType>('home');
  // 出品フロー実行中かどうか
  const [isListingMode, setIsListingMode] = useState<boolean>(false);

  // 出品ステッパー用状態
  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>('');
  const [productData, setProductData] = useState<ProductData | null>(null);
  // 完了・失敗トースト通知
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // 出品作業キャンセルの確認ダイアログ表示中かどうか
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState<boolean>(false);
  // 最近の出品からタップして詳細モーダルを開いている出品のID（未選択時はnull）
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
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

  const refreshListings = async () => {
    try {
      const data = await getListings();
      setSalesSummary(data.salesSummary);
      setRecentListings(data.recentListings);
    } catch (err) {
      // ホーム表示の初期取得失敗は致命的ではないため、トーストは出さず静かに諦める
      console.error('出品履歴の取得に失敗しました', err);
    }
  };

  // マウント時に一度、最近の出品・売上サマリーを取得
  useEffect(() => {
    refreshListings();
  }, []);

  // 画像アップロード処理
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingText('AIが画像から文字・属性を抽出中...');
    try {
      const result = useMockAnalysis ? await mockAnalyzeImage(file) : await analyzeImageWithAI(file);
      setProductData(result);
      setStep(2);
    } catch (err) {
      setFeedback({ type: 'error', message: 'AI解析に失敗しました' });
    } finally {
      setIsLoading(false);
    }
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
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center">
      {/* スマホ画面枠 */}
      <div className="w-full max-w-md bg-slate-50 text-slate-800 min-h-screen flex flex-col justify-between relative shadow-2xl pb-20">
        <Toast feedback={feedback} onClose={() => setFeedback(null)} />
        <CancelConfirmDialog
          open={isCancelConfirmOpen}
          onDismiss={() => setIsCancelConfirmOpen(false)}
          onConfirm={cancelListing}
        />
        {selectedListingId && (
          <ListingDetailModal listingId={selectedListingId} onClose={() => setSelectedListingId(null)} />
        )}

        {/* ================= 出品フローモーダル表示時 ================= */}
        {isListingMode ? (
          <div className="p-5 space-y-6 flex-1 bg-white">
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

            {!isLoading && step === 1 && <Step1_ImageUpload onUpload={handleImageUpload} />}

            {!isLoading && step === 2 && productData && (
              <Step2_MetadataEdit
                productData={productData}
                onChange={setProductData}
                onUpdateAspect={updateAspectValue}
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
        ) : (
          /* ================= 通常メイン画面（タブ切り替え） ================= */
          <main className="p-4 space-y-6 flex-1 overflow-y-auto">
            {activeTab === 'home' && (
              <HomeDashboard
                salesSummary={salesSummary}
                recentListings={recentListings}
                onStartListing={() => setIsListingMode(true)}
                onSelectListing={setSelectedListingId}
              />
            )}
            {activeTab === 'analytics' && <AnalyticsPanel />}
            {activeTab === 'settings' && (
              <SettingsPanel useMockAnalysis={useMockAnalysis} onToggleMockAnalysis={handleToggleMockAnalysis} />
            )}
          </main>
        )}

        {!isListingMode && <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />}
      </div>
    </div>
  );
}
