import { genAI, GEMINI_MODEL, generateJson } from './geminiClient.js';

// =================================================================
// 商品状態・欠陥検出エージェント（画像を見て状態を厳しく査定する）
// =================================================================
export async function runConditionAgent(base64Image, mimeType) {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `あなたはeBayの検品担当者です。この商品画像を厳しくチェックし、コンディションを評価してください。
JSON形式のみで出力:
{
  "conditionScore": 100が新品同様・0が大きく破損の0-100整数,
  "conditionLabel": "Like New / Excellent / Good / Fair / Poor のいずれか",
  "defects": ["画像から読み取れる傷・汚れ・欠損・摩耗などを箇条書き（無ければ空配列）"],
  "notes": "総合的な状態に関する1〜2文の所見（日本語）"
}`,
          },
          { inlineData: { mimeType, data: base64Image } },
        ],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });

  return JSON.parse(response.text || '{}');
}

// =================================================================
// 市場トレンド・需要分析エージェント（現在のアクティブ出品状況から需要シグナルを推定）
// 注意: eBay Browse APIはアクティブな出品のみを返すため、これは売却実績ではなく
// 「現在の競合出品状況」に基づく推定である点をUI上にも明示すること。
// =================================================================
export async function runMarketTrendAgent(keywords, items) {
  const prompt = `以下は、eBayで"${keywords}"を検索した際に現在出品中の類似商品一覧です（売却済みデータではありません）。
出品一覧: ${JSON.stringify(items)}

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
  const prompt = `自分がこれから出品しようとしている商品と、eBayで既に出品されている類似の競合商品一覧を比較してください。
自分の商品案: ${JSON.stringify(productDraft)}
競合出品（上位${items.length}件）: ${JSON.stringify(items)}

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
