import { supabase } from './supabaseClient.js';

// app_settingsテーブルの単純なキー・バリューストア。
// eBayのrefresh_tokenをここに保存することで、Renderのような永続ディスクが無い環境でも
// 再起動・再デプロイをまたいで接続状態を維持できる（.envへの書き込みだけに頼らない）。
export async function getSetting(key) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function setSetting(key, value) {
  if (!supabase) return;
  const { error } = await supabase.from('app_settings').upsert({ key, value });
  if (error) throw error;
}
