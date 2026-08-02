import dotenv from 'dotenv';
import Groq from 'groq-sdk';

// importの評価順序に関わらず.envを確実に読み込む（geminiClient.jsと同様の理由）
dotenv.config();

// Groq クライアント（各種エージェントから共有利用する）
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
export const GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

// GroqのレスポンスにMarkdownのコードフェンスや前置き文が混ざることがあるため、緩くJSON部分を抽出する
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
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: promptText }],
    response_format: { type: 'json_object' },
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
  });
  return parseJsonLoose(response.choices[0]?.message?.content);
}
