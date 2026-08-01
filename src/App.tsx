import React, { useEffect, useState } from 'react';
import type { TabType, RecentListing, SalesSummary } from './types/app';
import type { ProductData } from './types/listing';
import { analyzeImageWithAI, publishToEbay } from './services/listingService';
import { useLanguage } from './i18n/LanguageContext';
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

export default function App() {
  const { t } = useLanguage();

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

  // トースト通知を一定時間後に自動で閉じる
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(timer);
  }, [feedback]);

  // ダミーの売上データ
  const [salesSummary] = useState<SalesSummary>({
    totalRevenue: 12450.0,
    monthlyRevenue: 3200.5,
    activeListingsCount: 18,
    soldItemsCount: 42,
  });

  // ダミーの最近の出品
  const [recentListings, setRecentListings] = useState<RecentListing[]>([
    { id: '1', title: 'Sony WH-1000XM5 Wireless Headphones', price: 249.99, status: 'ACTIVE', date: '2026-07-28' },
    { id: '2', title: 'Nintendo Switch OLED Model White', price: 299.0, status: 'SOLD', date: '2026-07-25' },
    { id: '3', title: 'Logitech MX Master 3S Mouse', price: 85.5, status: 'ACTIVE', date: '2026-07-20' },
  ]);

  // 画像アップロード処理
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingText(t('loadingAnalyzing'));
    try {
      const result = await analyzeImageWithAI(file);
      setProductData(result);
      setStep(2);
    } catch (err) {
      setFeedback({ type: 'error', message: t('analysisFailure') });
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
    setLoadingText(t('loadingPublishing'));
    try {
      const result = await publishToEbay(productData);
      if (result.success) {
        setFeedback({ type: 'success', message: `${t('publishSuccessPrefix')} ${result.listingId}）` });

        const newListing: RecentListing = {
          id: result.listingId,
          title: productData.title,
          price: productData.pricing.suggestedPrice,
          status: 'ACTIVE',
          date: new Date().toISOString().split('T')[0],
        };
        setRecentListings([newListing, ...recentListings]);

        setIsListingMode(false);
        setStep(1);
        setProductData(null);
      }
    } catch (err) {
      setFeedback({ type: 'error', message: t('publishFailure') });
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

        {/* ================= 出品フローモーダル表示時 ================= */}
        {isListingMode ? (
          <div className="p-5 space-y-6 flex-1 bg-white">
            <header className="flex justify-between items-center border-b pb-3">
              <button
                onClick={() => setIsCancelConfirmOpen(true)}
                className="text-xs font-bold text-slate-400 hover:text-slate-600"
              >
                ✕ {t('wizardClose')}
              </button>
              <h1 className="text-base font-extrabold text-slate-800">{t('wizardTitle')}</h1>
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
              />
            )}
            {activeTab === 'analytics' && <AnalyticsPanel />}
            {activeTab === 'settings' && <SettingsPanel />}
          </main>
        )}

        {!isListingMode && <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />}
      </div>
    </div>
  );
}
