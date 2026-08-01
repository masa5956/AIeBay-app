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

export async function setEbayConnection(userId, { refreshToken, fulfillmentPolicyId, returnPolicyId, merchantLocationKey }) {
  if (!supabase) return;
  const { error } = await supabase.from('ebay_connections').upsert({
    user_id: userId,
    refresh_token: refreshToken,
    fulfillment_policy_id: fulfillmentPolicyId,
    return_policy_id: returnPolicyId,
    merchant_location_key: merchantLocationKey,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
