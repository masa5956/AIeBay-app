import { supabase } from './supabaseClient.js';
import { encryptAddress, decryptAddress } from './addressCrypto.js';

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

// 出荷元住所（ユーザーごと、暗号化して保存）。addressCrypto.jsのAES-256-GCMで暗号化した
// 1つのblobとしてshipping_address_encryptedカラムに保存する（個別カラムに平文で置かない）。
// ユーザーが未設定、または復号に失敗した場合（暗号化キーのローテーション等）はnullを返す
// ——呼び出し側に平文や例外の詳細を漏らさず、単に「未設定」として扱わせるため。
export async function getShippingAddress(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('user_settings')
    .select('shipping_address_encrypted')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.shipping_address_encrypted) return null;
  try {
    return decryptAddress(data.shipping_address_encrypted);
  } catch (err) {
    console.error('出荷元住所の復号に失敗しました（ユーザーID:', userId, '):', err.message);
    return null;
  }
}

export async function setShippingAddress(userId, address) {
  if (!supabase) return;
  const encrypted = encryptAddress(address);
  const { error } = await supabase.from('user_settings').upsert({
    user_id: userId,
    shipping_address_encrypted: encrypted,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// データ最小化のため、ユーザーが明示的に住所を削除できるようにする（設定タブの「削除」ボタン用）
export async function clearShippingAddress(userId) {
  if (!supabase) return;
  const { error } = await supabase.from('user_settings').upsert({
    user_id: userId,
    shipping_address_encrypted: null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
