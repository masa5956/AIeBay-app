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

// 住所再表示のパスワード再認証(POST /api/settings/shipping-address/reveal)専用。
// anon/publishableキーは公開して安全な設計のためservice_roleとは別に持つ意味がある——
// signInWithPasswordによる「このパスワードは正しいか」の検証だけに使い、RLSがdeny-allの
// ためこのクライアントではどのテーブルへもアクセスできない（データ読み書きは常にservice_role経由）。
export const supabaseAnon =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

export const PRODUCT_IMAGES_BUCKET = 'product-images';
