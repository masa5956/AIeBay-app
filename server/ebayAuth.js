import axios from 'axios';

export const EBAY_BASE_URL = process.env.EBAY_ENV === 'PRODUCTION'
  ? 'https://api.ebay.com'
  : 'https://api.sandbox.ebay.com';

// ユーザー同意画面（Authorization Code Grant）はapi.ebay.comではなくauth.ebay.com系ドメイン
export const EBAY_AUTH_URL = process.env.EBAY_ENV === 'PRODUCTION'
  ? 'https://auth.ebay.com/oauth2/authorize'
  : 'https://auth.sandbox.ebay.com/oauth2/authorize';

// 出品(sell.inventory)とBusiness Policies管理(sell.account)の両方に必要なスコープ
export const USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
].join(' ');

function basicAuthHeader() {
  return Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
}

// =================================================================
// eBay Application Access Token の取得 (Client Credentials Grant)
// Browse APIなど、ユーザー認可が不要なAPI呼び出しに使用する
// =================================================================
export async function getAppAccessToken() {
  const tokenResponse = await axios.post(
    `${EBAY_BASE_URL}/identity/v1/oauth2/token`,
    'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuthHeader()}`,
      },
    }
  );

  return tokenResponse.data.access_token;
}

// =================================================================
// eBay User Access Token の取得 (Refresh Token Grant)
// Sell Inventory/Offer/Account APIなど、ユーザー認可が必要なAPI呼び出しに使用する。
// 事前に /api/ebay/auth-url → /api/ebay/callback の同意フローでEBAY_USER_REFRESH_TOKENを
// 取得しておく必要がある（有効期限は通常18か月）。
// =================================================================
export async function getUserAccessToken() {
  if (!process.env.EBAY_USER_REFRESH_TOKEN) {
    throw new Error(
      'EBAY_USER_REFRESH_TOKENが未設定です。先に /api/ebay/auth-url からeBayユーザー同意フローを完了してください。'
    );
  }

  const tokenResponse = await axios.post(
    `${EBAY_BASE_URL}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.EBAY_USER_REFRESH_TOKEN,
      scope: USER_SCOPES,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuthHeader()}`,
      },
    }
  );

  return tokenResponse.data.access_token;
}

// =================================================================
// Authorization Code → refresh_token/access_token への交換
// eBayユーザー同意後のコールバックで一度だけ呼び出す
// =================================================================
export async function exchangeAuthCodeForTokens(code) {
  const tokenResponse = await axios.post(
    `${EBAY_BASE_URL}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.EBAY_RU_NAME || '',
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuthHeader()}`,
      },
    }
  );

  return tokenResponse.data; // { access_token, refresh_token, expires_in, ... }
}
