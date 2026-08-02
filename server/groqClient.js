import dotenv from 'dotenv';
import Groq from 'groq-sdk';

// importの評価順序に関わらず.envを確実に読み込む（geminiClient.jsと同様の理由）
dotenv.config();

// Groq クライアント（各種エージェントから共有利用する）
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
// 画像解析(vision)用モデル。旧デフォルト'meta-llama/llama-4-scout-17b-16e-instruct'はGroq側で
// 廃止され404になったため、現時点でvision対応が確認できているqwen/qwen3.6-27bを新デフォルトにする
// （Groqのモデルラインナップは変更が多いため、稼働しない場合は`groq.models.list()`で再確認すること）。
export const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';
// テキストのみのエージェント（市場トレンド・競合比較）用モデル。GROQ_MODELをqwen等の推論モデルに
// している場合、テキスト専用タスクにまで思考時間がかかり分析全体が遅くなるため、既定では
// 推論なしの高速モデルを別途使う（未設定時はvisionと同じGROQ_MODELにフォールバック）。
export const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';

// 推論（<think>ブロックを出す）モデルかどうかの簡易判定。reasoning_formatパラメータは
// 非対応モデルに渡すと400エラーになるため、対象モデルにのみ付与する。
const REASONING_MODEL_PATTERN = /qwen|deepseek-r1|gpt-oss/i;
function reasoningParams(model) {
  if (!REASONING_MODEL_PATTERN.test(model)) return {};
  // 推論モデルの<think>ブロックを応答に含めない（思考自体は内部で行われるため、
  // 打ち切られないよう出力上限にも余裕を持たせる）
  return { reasoning_format: 'hidden', max_completion_tokens: 4096 };
}

// GroqのレスポンスにMarkdownのコードフェンスや前置き文が混ざることがあるため、緩くJSON部分を抽出する。
function parseJsonLoose(text) {
  const raw = (text || '').trim();
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Groqのレスポンスをjsonとして解釈できませんでした: ' + raw.slice(0, 200));
  }
}

// テキストのみのプロンプトをGroqに投げ、JSONとしてパースして返す共通ヘルパー
export async function generateJson(promptText) {
  const response = await groq.chat.completions.create({
    model: GROQ_TEXT_MODEL,
    messages: [{ role: 'user', content: promptText }],
    response_format: { type: 'json_object' },
    ...reasoningParams(GROQ_TEXT_MODEL),
  });
  return parseJsonLoose(response.choices[0]?.message?.content);
}

// 画像(複数可)+テキストのプロンプトをGroqに投げ、JSONとしてパースして返す共通ヘルパー。
// images: [{ base64Image, mimeType }, ...]（1枚以上）。
// 注意: Groqの一部モデルは画像入力とresponse_format(json_object)の併用に非対応のため、
// ここではresponse_formatを指定せず、プロンプト側の指示＋緩いパースでJSONを取り出す。
export async function generateImageJson(promptText, images) {
  const imageParts = images.map(({ base64Image, mimeType }) => ({
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${base64Image}` },
  }));
  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `${promptText}\n\n出力は前置きや説明を一切付けず、JSONオブジェクトのみを出力してください。` },
          ...imageParts,
        ],
      },
    ],
    ...reasoningParams(GROQ_MODEL),
  });
  return parseJsonLoose(response.choices[0]?.message?.content);
}
