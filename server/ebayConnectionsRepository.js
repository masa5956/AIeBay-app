import { supabase } from './supabaseClient.js';

// ユーザーごとのeBay接続情報（refresh_token・Business Policy ID・出荷元ロケーション）を管理する。
// アプリ内「eBayでログイン」でユーザーが同意したeBayアカウントの情報をここに保存し、
// 以後そのユーザーの出品はこのアカウント・このポリシーで行われる。
export async function getEbayConnection(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.from('ebay_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getEbayRefreshToken(userId) {
  const connection = await getEbayConnection(userId);
  return connection?.refresh_token ?? null;
}

export async function setEbayConnection(
  userId,
  { refreshToken, fulfillmentPolicyId, returnPolicyId, merchantLocationKey, ebayUsername }
) {
  if (!supabase) return;
  const row = {
    user_id: userId,
    refresh_token: refreshToken,
    fulfillment_policy_id: fulfillmentPolicyId,
    return_policy_id: returnPolicyId,
    merchant_location_key: merchantLocationKey,
    updated_at: new Date().toISOString(),
  };
  // ebayUsernameは呼び出し側で取得できなかった場合(undefined)は既存の値を上書きしないよう省略する
  if (ebayUsername !== undefined) row.ebay_username = ebayUsername;

  const { error } = await supabase.from('ebay_connections').upsert(row);
  if (error) throw error;
}

// eBayのMarketplace Account Deletion/Closure通知を受信した際、そのeBayユーザー名に紐づく
// 接続情報（refresh_token等）を完全に削除し、連携を解除する（該当eBayアカウントを接続していた
// 全アプリユーザー分が対象。以後そのアカウントでは出品できなくなり、再接続するには
// 改めて「eBayでログイン」から同意し直す必要がある）。
export async function deleteEbayConnectionsByUsername(ebayUsername) {
  if (!supabase || !ebayUsername) return;
  const { error } = await supabase.from('ebay_connections').delete().eq('ebay_username', ebayUsername);
  if (error) throw error;
}
