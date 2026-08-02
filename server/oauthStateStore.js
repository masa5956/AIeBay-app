import crypto from 'node:crypto';

// eBay OAuth同意フローの"state"パラメータ用、使い捨て・有効期限付きのnonceストア。
// 以前は state=`${userId}:${environment}` という予測可能な値を直接使っており、
// 他人のSupabaseユーザーIDを知っていれば攻撃者自身のeBayアカウントを
// 他人のアプリアカウントに紐付けさせられてしまう懸念があった（OAuth CSRF/account-linking攻撃）。
// ここでは暗号学的に安全な乱数のnonceのみをstateとして渡し、
// userId/environmentとの対応はサーバー側メモリでのみ保持・一度きりの使用で消費する。
const pendingStates = new Map(); // nonce -> { userId, environment, expiresAt }
const TTL_MS = 10 * 60 * 1000; // 10分（OAuth同意に要する時間として十分かつ短命）

export function createOAuthState(userId, environment) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  pendingStates.set(nonce, { userId, environment, expiresAt: Date.now() + TTL_MS });
  return nonce;
}

// 一度だけ取り出せる（リプレイ攻撃防止のため取得と同時に必ず削除する）
export function consumeOAuthState(nonce) {
  if (!nonce || !pendingStates.has(nonce)) return null;
  const entry = pendingStates.get(nonce);
  pendingStates.delete(nonce);
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

// 同意を最後まで完了しなかった分の期限切れエントリを定期的に掃除する（メモリリーク防止）
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of pendingStates) {
    if (now > entry.expiresAt) pendingStates.delete(nonce);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();
