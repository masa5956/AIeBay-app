import axios from 'axios';
import crypto from 'node:crypto';
import { getAppAccessToken, getEbayEnvConfig } from './ebayAuth.js';

// eBayの公開鍵はkeyIdごとにキャッシュする（eBay公式SDKも同様の方針: 参考実装は
// https://github.com/eBay/event-notification-nodejs-sdk のlib/client.js）
const publicKeyCache = new Map(); // `${environment}:${keyId}` -> 生の鍵文字列

async function fetchPublicKey(keyId, environment) {
  const cacheKey = `${environment}:${keyId}`;
  if (publicKeyCache.has(cacheKey)) return publicKeyCache.get(cacheKey);

  const { baseUrl } = getEbayEnvConfig(environment);
  const appToken = await getAppAccessToken(environment);
  const response = await axios.get(`${baseUrl}/commerce/notification/v1/public_key/${keyId}`, {
    headers: { Authorization: `Bearer ${appToken}` },
  });
  publicKeyCache.set(cacheKey, response.data.key);
  return response.data.key;
}

// eBayの公開鍵APIは "-----BEGIN PUBLIC KEY-----...(改行なし)...-----END PUBLIC KEY-----"
// という改行の無いPEM風文字列を返すため、Node cryptoが読める形に改行を挿入する
function formatPublicKeyPem(rawKey) {
  return rawKey
    .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN PUBLIC KEY-----\n')
    .replace('-----END PUBLIC KEY-----', '\n-----END PUBLIC KEY-----');
}

// eBayからのMarketplace Account Deletion等の通知が本物か検証する。
// x-ebay-signatureヘッダー(base64→JSON、{kid, signature})をデコードし、
// 該当keyIdの公開鍵をeBayから取得して、リクエストボディ(JSON再直列化したもの)の署名を検証する。
// アルゴリズムはeBay公式Node SDKの実装に準拠（'ssl3-sha1'はOpenSSL 3.x/Node18+のデフォルト
// providerから外れ使えないことがあるため、暗号学的に等価な'sha1'を使用）。
// 参考実装: https://github.com/eBay/event-notification-nodejs-sdk/blob/main/lib/validator.js
export async function verifyEbayNotificationSignature(parsedBody, signatureHeader) {
  if (!signatureHeader) {
    return { verified: false, reason: 'x-ebay-signatureヘッダーがありません' };
  }

  let kid;
  let signature;
  try {
    const decoded = JSON.parse(Buffer.from(signatureHeader, 'base64').toString('ascii'));
    kid = decoded.kid;
    signature = decoded.signature;
    if (!kid || !signature) throw new Error('kid/signatureが含まれていません');
  } catch (err) {
    return { verified: false, reason: `signatureヘッダーの解析に失敗しました: ${err.message}` };
  }

  // 通知がSandbox/Productionどちらから来たか事前には分からないため、鍵が用意されている
  // 環境を順に試す（Production未設定ならSandboxのみ試す）
  const candidateEnvs = ['PRODUCTION', 'SANDBOX'].filter((environment) => {
    const { clientId, clientSecret } = getEbayEnvConfig(environment);
    return Boolean(clientId && clientSecret);
  });

  let lastError = null;
  for (const environment of candidateEnvs) {
    let rawKey;
    try {
      rawKey = await fetchPublicKey(kid, environment);
    } catch (err) {
      lastError = err; // この環境には該当鍵が無い等。次の環境を試す
      continue;
    }

    try {
      const verifier = crypto.createVerify('sha1');
      verifier.update(JSON.stringify(parsedBody));
      const isValid = verifier.verify(formatPublicKeyPem(rawKey), signature, 'base64');
      // 鍵の取得自体には成功しているため、ここでの真偽はそのまま確定結果として返す
      // （改ざん・偽造の疑いがある場合に他環境へフォールバックして誤魔化さないため）
      return isValid ? { verified: true } : { verified: false, reason: '署名が一致しません' };
    } catch (err) {
      return { verified: false, reason: `署名検証処理でエラーが発生しました: ${err.message}` };
    }
  }

  // どの環境でも鍵取得自体に失敗した場合はインフラ的な問題の可能性が高いため区別して返す
  // （呼び出し側は、本物の削除通知を取りこぼしてコンプライアンス違反になるリスクを踏まえて
  //   フェイルオープンするかどうかを判断できるようにする）
  return {
    verified: false,
    reason: `公開鍵の取得に失敗しました: ${lastError?.message || '不明なエラー'}`,
    infraError: true,
  };
}
