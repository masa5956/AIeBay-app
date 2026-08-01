import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// importの評価順序に関わらず.envを確実に読み込む（geminiClient.js等と同様の理由）
dotenv.config();

// バックエンド専用クライアント。service_roleキーを使うためRLSをバイパスできる。
// フロントエンドには絶対に渡さないこと。
export const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export const PRODUCT_IMAGES_BUCKET = 'product-images';
