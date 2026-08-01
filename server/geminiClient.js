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

// 画像+テキストのプロンプトをGeminiに投げ、JSONとしてパースして返す共通ヘルパー
export async function generateImageJson(promptText, base64Image, mimeType) {
  const response = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }, { inlineData: { mimeType, data: base64Image } }],
      },
    ],
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(response.text || '{}');
}
