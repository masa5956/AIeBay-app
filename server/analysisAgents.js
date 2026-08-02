import { generateJson, generateImageJson } from './aiProvider.js';
import { generateGroundedJson } from './geminiClient.js';

// =================================================================
// 商品状態・欠陥検出エージェント（画像を見て状態を厳しく査定する）
// images: [{ base64Image, mimeType }, ...]（1枚以上。複数枚の場合は全体を通して評価する）
// =================================================================
export async function runConditionAgent(images) {
  const multiNote = images.length > 1
    ? `\n複数枚（${images.length}枚）の画像が提供されています。写真ごとに違う角度・部位が写っている` +
      '可能性があるため、全ての画像を通して確認できた傷・汚れ・欠損を漏れなく反映してください。'
    : '';
  const prompt = `あなたはeBayの検品担当者です。この商品画像を厳しくチェックし、コンディションを評価してください。${multiNote}
JSON形式のみで出力:
{
  "conditionScore": 100が新品同様・0が大きく破損の0-100整数,
  "conditionLabel": "Like New / Excellent / Good / Fair / Poor のいずれか",
  "defects": ["画像から読み取れる傷・汚れ・欠損・摩耗などを箇条書き（無ければ空配列）"],
  "notes": "総合的な状態に関する1〜2文の所見（日本語）"
}`;

  return generateImageJson(prompt, images);
}

// =================================================================
// 市場価格調査エージェント（Gemini + Google検索グラウンディング）
// eBay Browse APIのキーワード完全一致検索は、AIが生成したタイトルがブランド/型番を
// 誤認識・一般化した場合に0件になりやすく「取得できない」ケースが多かった。この関数は
// eBayに限らずインターネット全体を検索させ、商品状態も踏まえてAI自身に相場を判断させる
// ため、より頑健に価格を返せる（常にGeminiを使う。Groqにはグラウンディング機能が無いため
// TEXT_AI_PROVIDER設定に関わらずgeminiClient.jsを直接呼ぶ）。
// index.js側ではこれを主経路とし、失敗時のみeBay Browse APIベースの旧経路へフォールバックする。
// =================================================================
export async function runMarketResearchAgent({ title, brand, model, condition, conditionAssessment }) {
  const conditionNote = conditionAssessment
    ? `AIによる状態診断: スコア${conditionAssessment.conditionScore}/100（${conditionAssessment.conditionLabel}）、` +
      `検出された難あり点: ${(conditionAssessment.defects || []).join('、') || 'なし'}`
    : `出品予定の状態区分: ${condition || '不明'}`;

  const prompt = `あなたはeBay出品の価格アドバイザーです。以下の商品について、インターネット検索で現在の実勢相場を調査し、
商品状態を考慮した適正なUSD価格帯を判断してください。

商品情報:
- タイトル: ${title}
- ブランド: ${brand || '不明'}
- 型番: ${model || '不明'}
- ${conditionNote}

eBayに限らず、メルカリ・Yahoo!オークション・Amazon・一般的な小売サイトなど、検索で見つかる実際の
販売実績・出品価格を幅広く参照してください（日本円の価格は判断時点のおおよその為替レートでUSDに
換算してください）。商品状態が良いほど価格は高め、悪いほど低めに調整してください。
類似商品が全く見つからない場合は、商品カテゴリの一般的な相場から妥当な推測値を出してください
（0円/0ドルにはしないでください）。

出力は前置きや説明、Markdown装飾を一切付けず、以下のJSON形式のみを出力してください:
{
  "min_price": number (USD, 相場の下限),
  "max_price": number (USD, 相場の上限),
  "suggested_price": number (USD, 状態を考慮した推奨出品価格),
  "market_trend": { "demandLevel": "High、Medium、Lowのいずれか", "trendNote": "需要・価格帯の傾向についての1〜2文の日本語コメント" },
  "competitor_suggestions": { "suggestions": ["具体的な改善提案を日本語で2〜4個"], "competitivePriceNote": "価格の妥当性についての1文コメント（日本語）" }
}`;

  return generateGroundedJson(prompt);
}

// =================================================================
// 市場トレンド・需要分析エージェント（現在のアクティブ出品状況から需要シグナルを推定）
// 注意: eBay Browse APIはアクティブな出品のみを返すため、これは売却実績ではなく
// 「現在の競合出品状況」に基づく推定である点をUI上にも明示すること。
// runMarketResearchAgent失敗時のフォールバック経路でのみ使用する。
// =================================================================
export async function runMarketTrendAgent(keywords, items) {
  const noDataNote = items.length === 0
    ? '\n注意: 類似出品が1件も見つかりませんでした。この場合はdemandLevelを"Medium"とし、trendNoteでは' +
      '「類似出品が見つからなかったため需要を推定できません。検索キーワードやカテゴリの見直しを推奨します」' +
      'という趣旨を日本語で述べてください。'
    : '';
  const prompt = `以下は、eBayで"${keywords}"を検索した際に現在出品中の類似商品一覧です（売却済みデータではありません）。
出品一覧: ${JSON.stringify(items)}
${noDataNote}
この一覧から、出品件数や価格のばらつきをもとに需要・競合状況を分析してください。JSON形式のみで出力:
{
  "demandLevel": "High、Medium、Lowのいずれか（出品件数の少なさ・価格の安定度から判断。出品が少なく価格が安定していればHigh寄り）",
  "trendNote": "需要・価格帯の傾向についての1〜2文の日本語コメント"
}`;

  return generateJson(prompt);
}

// =================================================================
// 競合比較エージェント（自分の出品案と競合出品を比較し差別化を提案）
// =================================================================
export async function runCompetitorAgent(productDraft, items) {
  const noDataNote = items.length === 0
    ? '\n注意: 比較対象となる競合出品が見つかりませんでした。suggestionsではタイトル・説明文・商品仕様自体の' +
      '一般的な改善提案を、competitivePriceNoteでは「競合データが無いため価格の妥当性は判断できません」' +
      'という趣旨を日本語で述べてください。'
    : '';
  const prompt = `自分がこれから出品しようとしている商品と、eBayで既に出品されている類似の競合商品一覧を比較してください。
自分の商品案: ${JSON.stringify(productDraft)}
競合出品（上位${items.length}件）: ${JSON.stringify(items)}
${noDataNote}
タイトル・価格の観点で、競合と比べてどう差別化・改善すべきかを提案してください。JSON形式のみで出力:
{
  "suggestions": ["具体的な改善提案を日本語で箇条書き（2〜4個程度）"],
  "competitivePriceNote": "価格が競合と比べて高いか安いか妥当かについての1文コメント（日本語）"
}`;

  return generateJson(prompt);
}

// =================================================================
// 総合判定スコア（LLM呼び出しではなく決定的な計算。高速・低コスト・再現性を優先）
// =================================================================
export function scoreListing({ conditionResult, marketResult, productDraft, pricing }) {
  const conditionScore = clamp(conditionResult?.conditionScore ?? 70, 0, 100);

  const { minPrice = 0, maxPrice = 0, userPrice = 0 } = pricing || {};
  let priceScore = 70;
  if (maxPrice > minPrice) {
    if (userPrice >= minPrice && userPrice <= maxPrice) {
      priceScore = 100;
    } else {
      const range = maxPrice - minPrice;
      const distance = userPrice < minPrice ? minPrice - userPrice : userPrice - maxPrice;
      priceScore = clamp(100 - (distance / range) * 100, 0, 100);
    }
  }

  const titleLength = productDraft?.title?.length || 0;
  const descriptionLength = productDraft?.description?.length || 0;
  const aspectsCount = productDraft?.aspects?.length || 0;
  const completenessScore = clamp(
    (Math.min(titleLength, 80) / 80) * 40 +
      (Math.min(descriptionLength, 800) / 800) * 40 +
      (Math.min(aspectsCount, 8) / 8) * 20,
    0,
    100
  );

  const demandBonus = { High: 10, Medium: 0, Low: -10 }[marketResult?.demandLevel] ?? 0;

  const weighted =
    conditionScore * 0.3 +
    priceScore * 0.3 +
    completenessScore * 0.25 +
    (70 + demandBonus) * 0.15;

  const overallScore = Math.round(clamp(weighted, 0, 100));

  let recommendation;
  if (overallScore >= 80) {
    recommendation = '出品準備は良好です。このまま出品できます。';
  } else if (overallScore >= 60) {
    recommendation = '出品可能ですが、価格や商品説明を見直すとより売れやすくなります。';
  } else {
    recommendation = '出品前に商品状態の記載・価格・タイトルの見直しを推奨します。';
  }

  return { overallScore, recommendation };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
