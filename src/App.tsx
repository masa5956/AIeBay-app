import React, { useEffect, useState } from 'react';
import type { TabType, RecentListing, SalesSummary } from './types/app';
import type { ProductData } from './types/listing';
import { analyzeImageWithAI, publishToEbay } from './services/listingService';

// 完了・失敗を知らせるトースト通知の内容
type Feedback = { type: 'success' | 'error'; message: string };

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

  // トースト通知を一定時間後に自動で閉じる
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(timer);
  }, [feedback]);

  // ダミーの売上データ
  const [salesSummary] = useState<SalesSummary>({
    totalRevenue: 12450.00,
    monthlyRevenue: 3200.50,
    activeListingsCount: 18,
    soldItemsCount: 42,
  });

  // ダミーの最近の出品
  const [recentListings, setRecentListings] = useState<RecentListing[]>([
    {
      id: '1',
      title: 'Sony WH-1000XM5 Wireless Headphones',
      price: 249.99,
      status: 'ACTIVE',
      date: '2026-07-28',
    },
    {
      id: '2',
      title: 'Nintendo Switch OLED Model White',
      price: 299.00,
      status: 'SOLD',
      date: '2026-07-25',
    },
    {
      id: '3',
      title: 'Logitech MX Master 3S Mouse',
      price: 85.50,
      status: 'ACTIVE',
      date: '2026-07-20',
    },
  ]);

  // 画像アップロード処理
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingText('AIが画像から文字・属性を抽出中...');
    try {
      const result = await analyzeImageWithAI(file);
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

        // 最近の出品に追加
        const newListing: RecentListing = {
          id: result.listingId,
          title: productData.title,
          price: productData.pricing.suggestedPrice,
          status: 'ACTIVE',
          date: new Date().toISOString().split('T')[0],
        };
        setRecentListings([newListing, ...recentListings]);

        // モード解除
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center">
      {/* スマホ画面枠 */}
      <div className="w-full max-w-md bg-slate-50 text-slate-800 min-h-screen flex flex-col justify-between relative shadow-2xl pb-20">

        {/* ================= 完了・失敗トースト通知 ================= */}
        {feedback && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-[92%]">
            <div
              className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg text-white ${
                feedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            >
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
                {feedback.type === 'success' ? '✓' : '✕'}
              </div>
              <p className="text-xs font-semibold flex-1">{feedback.message}</p>
              <button
                onClick={() => setFeedback(null)}
                className="flex-shrink-0 text-white/70 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ================= 出品キャンセル確認ダイアログ ================= */}
        {isCancelConfirmOpen && (
          <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
            <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-4 shadow-xl text-center">
              <p className="text-sm font-bold text-slate-700">出品作業をキャンセルしますか？</p>
              <p className="text-xs text-slate-400">入力した内容は破棄されます</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsCancelConfirmOpen(false)}
                  className="w-1/2 border py-2 rounded-lg text-xs font-bold text-slate-600"
                >
                  戻る
                </button>
                <button
                  onClick={() => {
                    setIsCancelConfirmOpen(false);
                    setIsListingMode(false);
                    setStep(1);
                    setProductData(null);
                  }}
                  className="w-1/2 bg-red-600 text-white py-2 rounded-lg text-xs font-bold"
                >
                  キャンセルする
                </button>
              </div>
            </div>
          </div>
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

            {/* ステッパーナビ（クリックで各ステップへ移動可能） */}
            <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b pb-2">
              <button onClick={() => goToStep(1)} className={step >= 1 ? 'text-blue-600' : ''}>
                1. 撮影
              </button>
              <span>&gt;</span>
              <button
                onClick={() => goToStep(2)}
                disabled={!productData}
                className={`${step >= 2 ? 'text-blue-600' : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                2. 解析
              </button>
              <span>&gt;</span>
              <button
                onClick={() => goToStep(3)}
                disabled={!productData}
                className={`${step >= 3 ? 'text-blue-600' : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                3. 価格
              </button>
              <span>&gt;</span>
              <button
                onClick={() => goToStep(4)}
                disabled={!productData}
                className={`${step >= 4 ? 'text-blue-600' : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                4. 出品
              </button>
            </div>

            {/* ローディング */}
            {isLoading && (
              <div className="text-center py-16 space-y-3">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto"></div>
                <p className="text-sm font-semibold text-slate-600">{loadingText}</p>
              </div>
            )}

            {/* Step 1: 撮影 */}
            {!isLoading && step === 1 && (
              <div className="space-y-4 text-center py-6">
                <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 bg-slate-50 space-y-4">
                  <div className="text-4xl">📷</div>
                  <p className="text-xs text-slate-500">商品のラベルや型番が見えるように撮影してください</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="camera-input-wizard"
                  />
                  <label
                    htmlFor="camera-input-wizard"
                    className="cursor-pointer bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow hover:bg-blue-700 transition block text-sm"
                  >
                    カメラを起動 / 写真を選択
                  </label>
                </div>
              </div>
            )}

            {/* Step 2: 確認 */}
            {!isLoading && step === 2 && productData && (
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-700">AI解析情報の補正</h2>
                {productData.imageUrl && (
                  <img src={productData.imageUrl} alt="Preview" className="w-full h-36 object-cover rounded-lg border" />
                )}
                <div>
                  <label className="text-xs font-semibold text-slate-500">タイトル (Max 80文字)</label>
                  <input
                    type="text"
                    value={productData.title}
                    maxLength={80}
                    onChange={(e) => setProductData({ ...productData, title: e.target.value })}
                    className="w-full border p-2 rounded text-sm mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block text-right">{productData.title.length}/80文字</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-500">ブランド</label>
                    <input
                      type="text"
                      value={productData.brand}
                      onChange={(e) => setProductData({ ...productData, brand: e.target.value })}
                      className="w-full border p-2 rounded text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">型番</label>
                    <input
                      type="text"
                      value={productData.model}
                      onChange={(e) => setProductData({ ...productData, model: e.target.value })}
                      className="w-full border p-2 rounded text-sm mt-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500">商品説明</label>
                  <textarea
                    value={productData.description}
                    onChange={(e) => setProductData({ ...productData, description: e.target.value })}
                    rows={8}
                    className="w-full border p-2 rounded text-sm mt-1 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>

                {/* 商品仕様 (Item Specifics) */}
                {productData.aspects.length > 2 && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500">商品仕様 (Item Specifics)</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {productData.aspects.slice(2).map((aspect, i) => (
                        <div key={aspect.key}>
                          <label className="text-[10px] text-slate-400">{aspect.key}</label>
                          <input
                            type="text"
                            value={aspect.value}
                            onChange={(e) => updateAspectValue(i + 2, e.target.value)}
                            className="w-full border p-2 rounded text-sm mt-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => goToStep(1)} className="w-1/2 border py-3 rounded-lg text-xs font-bold">
                    戻る
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="w-1/2 bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition text-xs"
                  >
                    価格調整へ進む
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: 価格 */}
            {!isLoading && step === 3 && productData && (
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-700">価格調整</h2>
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg space-y-1">
                  <span className="text-[10px] font-bold text-blue-600 uppercase">AI適正査定額</span>
                  <div className="text-2xl font-black text-blue-900">${productData.pricing.suggestedPrice}</div>
                  <p className="text-[10px] text-slate-500">市場レンジ: ${productData.pricing.minPrice} - ${productData.pricing.maxPrice}</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">出品設定価格 ($USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={productData.pricing.suggestedPrice}
                    onChange={(e) => setProductData({
                      ...productData,
                      pricing: { ...productData.pricing, suggestedPrice: parseFloat(e.target.value) || 0 }
                    })}
                    className="w-full border p-2 rounded text-sm mt-1 font-bold"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => goToStep(2)} className="w-1/2 border py-3 rounded-lg text-xs font-bold">戻る</button>
                  <button onClick={() => goToStep(4)} className="w-1/2 bg-blue-600 text-white py-3 rounded-lg text-xs font-bold">最終確認へ</button>
                </div>
              </div>
            )}

            {/* Step 4: 最終プレビュー */}
            {!isLoading && step === 4 && productData && (
              <div className="space-y-4">
                <h2 className="text-sm font-bold text-slate-700">最終確認</h2>
                <div className="border p-3 rounded-lg space-y-2 bg-slate-50 text-xs">
                  <p><span className="font-bold">タイトル:</span> {productData.title}</p>
                  <p><span className="font-bold">価格:</span> ${productData.pricing.suggestedPrice}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => goToStep(3)} className="w-1/2 border py-3 rounded-lg text-xs font-bold">
                    戻る
                  </button>
                  <button
                    onClick={handlePublish}
                    className="w-1/2 bg-green-600 text-white font-extrabold py-3 rounded-lg shadow hover:bg-green-700 transition text-xs"
                  >
                    eBayに出品を確定する
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ================= 通常メイン画面（タブ切り替え） ================= */
          <main className="p-4 space-y-6 flex-1 overflow-y-auto">
            
            {/* 1. ホームタブ */}
            {activeTab === 'home' && (
              <div className="space-y-6">
                
                {/* アプリヘッダー */}
                <div className="flex justify-between items-center pt-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">Welcome Back</p>
                    <h1 className="text-lg font-black text-slate-800">eBay AI Lister</h1>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                    US
                  </div>
                </div>

                {/* 画面中部: 売上ダッシュボード */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white shadow-xl space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs text-slate-400 font-medium">今月の売上 (Total Revenue)</p>
                      <h2 className="text-3xl font-black mt-1">${salesSummary.monthlyRevenue.toLocaleString()}</h2>
                    </div>
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-full border border-emerald-500/30">
                      +14.2%
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/60 text-xs">
                    <div>
                      <p className="text-slate-400 text-[10px]">アクティブ出品中</p>
                      <p className="font-bold text-slate-200 mt-0.5">{salesSummary.activeListingsCount} 件</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-[10px]">累計販売実績</p>
                      <p className="font-bold text-slate-200 mt-0.5">{salesSummary.soldItemsCount} 件</p>
                    </div>
                  </div>
                </div>

                {/* 出品メインアクションボタン */}
                <button
                  onClick={() => setIsListingMode(true)}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-extrabold py-4 rounded-xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition"
                >
                  <span className="text-xl">📷</span>
                  <span>写真から出品を作成する</span>
                </button>

                {/* 画面下部: 最近の出品リスト */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-bold text-slate-800">最近の出品 (Recent Listings)</h3>
                    <span className="text-xs text-blue-600 font-semibold cursor-pointer">すべて見る</span>
                  </div>

                  <div className="space-y-2">
                    {recentListings.map((item) => (
                      <div key={item.id} className="bg-white border rounded-xl p-3 flex justify-between items-center shadow-sm hover:border-slate-300 transition">
                        <div className="space-y-1 max-w-[200px]">
                          <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                          <p className="text-[10px] text-slate-400">{item.date}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-black text-slate-900">${item.price}</p>
                          <span
                            className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded ${
                              item.status === 'ACTIVE'
                                ? 'bg-blue-50 text-blue-600'
                                : 'bg-emerald-50 text-emerald-600'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* 2. 分析タブ (プレースホルダー) */}
            {activeTab === 'analytics' && (
              <div className="space-y-4 pt-2">
                <h1 className="text-base font-bold text-slate-800">販売統計分析 (Analytics)</h1>
                <div className="bg-white border rounded-xl p-4 text-center space-y-3">
                  <p className="text-xs text-slate-500">過去の利益率や売れ筋カテゴリのグラフを表示予定です</p>
                  <div className="h-40 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs font-bold">
                    [ 売上グラフ表示領域 ]
                  </div>
                </div>
              </div>
            )}

            {/* 3. 設定タブ (プレースホルダー) */}
            {activeTab === 'settings' && (
              <div className="space-y-4 pt-2">
                <h1 className="text-base font-bold text-slate-800">アカウント設定 (Settings)</h1>
                <div className="bg-white border rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b">
                    <span>eBay連携状態</span>
                    <span className="text-emerald-600 font-bold">Sandbox 接続中</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span>AIエンジン</span>
                    <span className="text-slate-600 font-bold">Gemini 3.6 Flash (VLM)</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span>デフォルト通貨</span>
                    <span className="text-slate-600 font-bold">USD ($)</span>
                  </div>
                </div>
              </div>
            )}

          </main>
        )}

        {/* ================= 画面下部 タスクバー（ボトムナビゲーション） ================= */}
        {!isListingMode && (
          <nav className="absolute bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 flex justify-around items-center px-4 z-10 shadow-lg">
            
            {/* ホームボタン */}
            <button
              onClick={() => setActiveTab('home')}
              className={`flex flex-col items-center gap-1 ${
                activeTab === 'home' ? 'text-blue-600' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 00-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-[10px] font-bold">ホーム</span>
            </button>

            {/* 分析ボタン */}
            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex flex-col items-center gap-1 ${
                activeTab === 'analytics' ? 'text-blue-600' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-[10px] font-bold">分析</span>
            </button>

            {/* 設定ボタン */}
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex flex-col items-center gap-1 ${
                activeTab === 'settings' ? 'text-blue-600' : 'text-slate-400'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-[10px] font-bold">設定</span>
            </button>

          </nav>
        )}

      </div>
    </div>
  );
}