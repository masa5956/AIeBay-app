import dotenv from 'dotenv';
import Groq from 'groq-sdk';

// importの評価順序に関わらず.envを確実に読み込む（geminiClient.jsと同様の理由）
dotenv.config();

// Groq クライアント（各種エージェントから共有利用する）
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
export const GROQ_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

// GroqのレスポンスにMarkdownのコードフェンスや前置き文が混ざることがあるため、緩くJSON部分を抽出する。
// 一部のモデル（例: qwen/qwen3.6-27b等の推論モデル）は本文の前に<think>...</think>で思考過程を
// 出力することがある。以前は<think>ブロックを正規表現で除去していたが、思考が長く出力トークン上限に
// 収まりきらず閉じタグ</think>の手前で応答が打ち切られるケースがあり、その場合は除去しきれず失敗していた。
// そのため呼び出し側で reasoning_format: 'hidden' を指定し、Groq API自体に思考ブロックを応答へ
// 含めさせない（最終回答のみ返す）方式に変更した。ここではMarkdownフェンス除去のみ行う。
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
    // 推論モデルの<think>ブロックを応答に含めない（思考自体は内部で行われるため、
    // 打ち切られないよう出力上限にも余裕を持たせる）
    reasoning_format: 'hidden',
    max_completion_tokens: 4096,
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
    // 推論モデルの<think>ブロックを応答に含めない（思考自体は内部で行われるため、
    // 打ち切られないよう出力上限にも余裕を持たせる）
    reasoning_format: 'hidden',
    max_completion_tokens: 4096,
  });
  return parseJsonLoose(response.choices[0]?.message?.content);
}
