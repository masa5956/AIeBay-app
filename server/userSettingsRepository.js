import { supabase } from './supabaseClient.js';

// ユーザーごとに「今どちらのeBay環境（SANDBOX/PRODUCTION）で出品するか」を保持する。
// 設定タブでの即時切替に使用（切替時にサーバー再起動やデプロイは不要）。
export async function getActiveEbayEnv(userId) {
  if (!supabase || !userId) return 'SANDBOX';
  const { data, error } = await supabase
    .from('user_settings')
    .select('active_ebay_env')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.active_ebay_env || 'SANDBOX';
}

export async function setActiveEbayEnv(userId, environment) {
  if (!supabase) return;
  const { error } = await supabase.from('user_settings').upsert({
    user_id: userId,
    active_ebay_env: environment,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
