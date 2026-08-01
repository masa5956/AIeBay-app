import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// importの評価順序に関わらず.envを確実に読み込む（geminiClient.js等と同様の理由）
dotenv.config();

// バックエンド専用クライアント。service_roleキーを使うためRLSをバイパスできる。
// フロントエンドには絶対に渡さないこと。
// 未設定の場合createClient()自体が例外を投げてサーバー起動ごと落ちてしまうため、
// 未設定時はnullにしてSupabase関連機能だけを無効化する（eBay/AI機能は継続動作させる）。
export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export const PRODUCT_IMAGES_BUCKET = 'product-images';
