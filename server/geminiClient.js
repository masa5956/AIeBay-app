import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// importの評価順序に関わらず.envを確実に読み込む（index.js側のdotenv.config()より前に
// このモジュールの初期化コードが実行され得るため）
dotenv.config();

// Gemini クライアント（各種エージェントから共有利用する）
export const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// テキストのみのプロンプトをGeminiに投げ、JSONとしてパースして返す共通ヘルパー
export async function generateJson(promptText) {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(response.text || '{}');
}

// 画像(複数可)+テキストのプロンプトをGeminiに投げ、JSONとしてパースして返す共通ヘルパー。
// images: [{ base64Image, mimeType }, ...]（1枚以上）。複数枚の場合、Geminiは1回の呼び出しで
// 全画像をまとめて解釈できるため、角度違いの写真から一つの結果を合成させることができる。
export async function generateImageJson(promptText, images) {
  const imageParts = images.map(({ base64Image, mimeType }) => ({
    inlineData: { mimeType, data: base64Image },
  }));
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }, ...imageParts],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(response.text || '{}');
}

// Google検索でグラウンディングしたテキストのみのプロンプトをGeminiに投げ、JSONとしてパースして返す。
// 注意: Gemini APIはtools(googleSearch)とresponseMimeType:'application/json'の同時指定を
// サポートしていない（400エラーになる）ため、プロンプト側でJSONのみの出力を指示し、
// 返ってきたテキストからMarkdownフェンス等を緩く取り除いてパースする。
function parseJsonLoose(text) {
  const raw = (text || '').trim();
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Geminiのレスポンスをjsonとして解釈できませんでした: ' + raw.slice(0, 200));
  }
}

export async function generateGroundedJson(promptText) {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    config: { tools: [{ googleSearch: {} }] },
  });
  return parseJsonLoose(response.text);
}
