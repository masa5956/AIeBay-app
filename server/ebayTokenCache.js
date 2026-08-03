// eBayのアクセストークン（app token・user token）はいずれも発行から約2時間有効だが、
// 従来は/api/estimate-priceや/api/publish-ebayを呼ぶたびに毎回リフレッシュ通信を
// 行っていた（不要なネットワークI/O）。ここでメモリ内にexpires_inベースでキャッシュし、
// 有効なトークンが残っている間は再取得をスキップする。
const SAFETY_MARGIN_MS = 60 * 1000; // 期限ギリギリでの失効を避けるため60秒早めに切れたことにする

const appTokenCache = new Map(); // environment -> { token, expiresAt }
const userTokenCache = new Map(); // `${userId}:${environment}` -> { token, expiresAt }

export function getCachedAppToken(environment) {
  const entry = appTokenCache.get(environment);
  if (entry && Date.now() < entry.expiresAt) return entry.token;
  return null;
}

export function setCachedAppToken(environment, token, expiresInSeconds) {
  appTokenCache.set(environment, { token, expiresAt: Date.now() + expiresInSeconds * 1000 - SAFETY_MARGIN_MS });
}

export function getCachedUserToken(userId, environment) {
  const entry = userTokenCache.get(`${userId}:${environment}`);
  if (entry && Date.now() < entry.expiresAt) return entry.token;
  return null;
}

export function setCachedUserToken(userId, environment, token, expiresInSeconds) {
  userTokenCache.set(`${userId}:${environment}`, {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000 - SAFETY_MARGIN_MS,
  });
}

// eBay連携を解除した際、まだ有効期限内のキャッシュ済みaccess_tokenが残っていると、DBの
// refresh_tokenを削除した後もその期限が切れるまで出品等のAPI呼び出しが動いてしまう
// （解除したはずなのに動く、という分かりにくい状態になる）ため、解除操作と同時に破棄する。
export function clearCachedUserToken(userId, environment) {
  userTokenCache.delete(`${userId}:${environment}`);
}
