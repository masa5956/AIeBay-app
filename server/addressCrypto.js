import crypto from 'crypto';

// ユーザーの出荷元住所（個人情報）をDBに平文で保存しないためのアプリ層暗号化。
// SupabaseのディスクレベルAES-256暗号化とは別に、このアプリだけが持つ鍵
// (SHIPPING_ADDRESS_ENCRYPTION_KEY, .env限定・gitignore対象)がなければ復号できないようにする。
// これにより、service_roleキー漏洩やDBダンプ流出など「Supabase側だけが侵害されたケース」でも
// 住所本体は読み取れない（service_roleはRLSをバイパスするため、RLSだけでは防げない脅威）。
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM推奨サイズ
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const keyB64 = process.env.SHIPPING_ADDRESS_ENCRYPTION_KEY;
  if (!keyB64) {
    // 鍵が無い場合は平文保存にフォールバックせず必ず例外を投げる（fail-closed）。
    throw new Error(
      'SHIPPING_ADDRESS_ENCRYPTION_KEYが未設定です。' +
      '`openssl rand -base64 32` で生成した値を.envに設定してください。'
    );
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('SHIPPING_ADDRESS_ENCRYPTION_KEYは32バイト(base64エンコード)である必要があります。');
  }
  return key;
}

// 住所オブジェクトを暗号化し、DBの1カラムにそのまま保存できるbase64文字列にする
// （iv + authTag + 暗号文を連結。フィールドごとの長さ等のメタデータが個別カラムから
// 推測できないよう、住所全体を1つのJSONとしてまとめて暗号化する）。
export function encryptAddress(address) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(address), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptAddress(encryptedBase64) {
  const key = getKey();
  const blob = Buffer.from(encryptedBase64, 'base64');
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
