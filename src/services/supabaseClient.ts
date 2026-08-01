import { createClient } from '@supabase/supabase-js';

// フロントエンド用Supabaseクライアント。publishable(旧anon)キーのみを使用し、
// バックエンド専用のservice_role/secretキーは絶対にここに含めない。
// アプリのログイン(サインアップ/ログイン/セッション管理)にのみ使用し、
// listings等のデータはこのクライアントからは直接読み書きしない
// （すべてExpressバックエンド経由でuser_idスコープのアクセス制御を行う）。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey);
