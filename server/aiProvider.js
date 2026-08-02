import dotenv from 'dotenv';
import * as gemini from './geminiClient.js';
import * as groq from './groqClient.js';

dotenv.config();

// .envの AI_PROVIDER で画像解析(vision)に使うAIエンジンを切り替える（未設定時はGemini）。
// 例: Geminiの無料枠レート制限に達した場合、.envの AI_PROVIDER=groq に変更してサーバーを再起動するだけで切替可能。
export const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

// テキストのみのエージェント（市場トレンド分析・競合比較。画像を見る必要が無い）用に、
// 画像解析とは別のAIエンジンを指定できる（未設定時はAI_PROVIDERと同じものを使う）。
// 1商品の出品につき基本抽出・商品状態・市場トレンド・競合比較の最大4回のAI呼び出しが発生するため、
// 例えばTEXT_AI_PROVIDER=groqにすると、画像を伴う2回はGemini、テキストのみの2回はGroqに分散でき、
// 単一プロバイダーのレート制限に達しにくくなる。
export const TEXT_AI_PROVIDER = (process.env.TEXT_AI_PROVIDER || AI_PROVIDER).toLowerCase();

const visionProvider = AI_PROVIDER === 'groq' ? groq : gemini;
const textProvider = TEXT_AI_PROVIDER === 'groq' ? groq : gemini;

export const generateJson = textProvider.generateJson;
export const generateImageJson = visionProvider.generateImageJson;
