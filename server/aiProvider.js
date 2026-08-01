import dotenv from 'dotenv';
import * as gemini from './geminiClient.js';
import * as groq from './groqClient.js';

dotenv.config();

// .envの AI_PROVIDER で使用するAIエンジンを切り替える（未設定時はGemini）
// 例: Geminiの無料枠レート制限に達した場合、.envの AI_PROVIDER=groq に変更してサーバーを再起動するだけで切替可能
export const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const provider = AI_PROVIDER === 'groq' ? groq : gemini;

export const generateJson = provider.generateJson;
export const generateImageJson = provider.generateImageJson;
