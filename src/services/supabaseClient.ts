import { createClient } from '@supabase/supabase-js';

// フロントエンド用Supabaseクライアント。publishable(旧anon)キーのみを使用し、
// バックエンド専用のservice_role/secretキーは絶対にここに含めない。
// アプリのログイン(サインアップ/ログイン/セッション管理)にのみ使用し、
// listings等のデータはこのクライアントからは直接読み書きしない
// （すべてExpressバックエンド経由でuser_idスコープのアクセス制御を行う）。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY が未設定だと createClient() が
// 不正なURLとして例外を投げ、アプリ全体が真っ白になってしまうため、
// 未設定時はダミーの有効なURLを渡して初期化自体は必ず成功させ、
// App.tsx側でisSupabaseConfiguredを見て分かりやすい案内を表示する。
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-anon-key'
);
