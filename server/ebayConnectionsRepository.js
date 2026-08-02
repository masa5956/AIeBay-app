import { supabase } from './supabaseClient.js';

// ユーザー×環境(SANDBOX/PRODUCTION)ごとのeBay接続情報（refresh_token・Business Policy ID・
// 出荷元ロケーション）を管理する。1ユーザーがSandbox/Productionの両方を同時に接続でき、
// 実際にどちらを使うかは`user_settings.active_ebay_env`（userSettingsRepository.js）で決まる。
export async function getEbayConnection(userId, environment) {
  if (!supabase || !userId || !environment) return null;
  const { data, error } = await supabase
    .from('ebay_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('environment', environment)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// 設定タブでSandbox/Production両方の接続状態を一度に表示するための取得
export async function getAllEbayConnections(userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase.from('ebay_connections').select('*').eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function getEbayRefreshToken(userId, environment) {
  const connection = await getEbayConnection(userId, environment);
  return connection?.refresh_token ?? null;
}

export async function setEbayConnection(
  userId,
  environment,
  { refreshToken, fulfillmentPolicyId, returnPolicyId, merchantLocationKey, ebayUsername }
) {
  if (!supabase) return;
  const row = {
    user_id: userId,
    environment,
    refresh_token: refreshToken,
    fulfillment_policy_id: fulfillmentPolicyId,
    return_policy_id: returnPolicyId,
    merchant_location_key: merchantLocationKey,
    updated_at: new Date().toISOString(),
  };
  // ebayUsernameは呼び出し側で取得できなかった場合(undefined)は既存の値を上書きしないよう省略する
  if (ebayUsername !== undefined) row.ebay_username = ebayUsername;

  const { error } = await supabase.from('ebay_connections').upsert(row, { onConflict: 'user_id,environment' });
  if (error) throw error;
}

// eBayのMarketplace Account Deletion/Closure通知を受信した際、そのeBayユーザー名に紐づく
// 接続情報（refresh_token等）を完全に削除し、連携を解除する（該当eBayアカウントを接続していた
// 全アプリユーザー・全環境分が対象。以後そのアカウントでは出品できなくなり、再接続するには
// 改めて「eBayでログイン」から同意し直す必要がある）。
export async function deleteEbayConnectionsByUsername(ebayUsername) {
  if (!supabase || !ebayUsername) return;
  const { error } = await supabase.from('ebay_connections').delete().eq('ebay_username', ebayUsername);
  if (error) throw error;
}
