import dotenv from 'dotenv';
import axios from 'axios';
import { getEbayRefreshToken } from './ebayConnectionsRepository.js';

// importの評価順序に関わらず.envを確実に読み込む（index.js側のdotenv.config()より前に
// このモジュールの初期化コードが実行され得るため）
dotenv.config();

export const EBAY_BASE_URL = process.env.EBAY_ENV === 'PRODUCTION'
  ? 'https://api.ebay.com'
  : 'https://api.sandbox.ebay.com';

// Commerce Identity API（ユーザー名取得）はapi.ではなくapiz.ドメイン
const EBAY_IDENTITY_BASE_URL = process.env.EBAY_ENV === 'PRODUCTION'
  ? 'https://apiz.ebay.com'
  : 'https://apiz.sandbox.ebay.com';

// ユーザー同意画面（Authorization Code Grant）はapi.ebay.comではなくauth.ebay.com系ドメイン
export const EBAY_AUTH_URL = process.env.EBAY_ENV === 'PRODUCTION'
  ? 'https://auth.ebay.com/oauth2/authorize'
  : 'https://auth.sandbox.ebay.com/oauth2/authorize';

// 出品(sell.inventory)とBusiness Policies管理(sell.account)の両方に必要なスコープ。
// getUserAccessToken()のrefresh token grantで常に使うため、ここに新しいスコープを追加すると
// 「過去に同意していないスコープを要求した」として既存接続ユーザーのトークン更新が失敗し、
// 出品自体が壊れる。新しいスコープが必要な場合はAUTH_SCOPES側にのみ追加すること。
export const USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
].join(' ');

// 初回同意画面（/api/ebay/auth-url）でのみ使う、USER_SCOPESに加えて
// アカウント削除通知の突合用にeBayユーザー名を取得するためのスコープを含む広いスコープ一覧。
// 同意直後のaccess_token（refresh grantではなくauthorization_code交換で得たトークン）でのみ使用する。
export const AUTH_SCOPES = [
  USER_SCOPES,
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
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
// userIdを渡した場合はSupabaseのebay_connectionsからそのユーザーが接続したeBayアカウントの
// refresh_tokenを取得する（アプリ内ログインの本体）。userId省略時は.envのEBAY_USER_REFRESH_TOKEN
// を使う（`npm run setup:policies`のローカル手動実行専用のフォールバック）。
// =================================================================
export async function getUserAccessToken(userId) {
  const refreshToken = userId ? await getEbayRefreshToken(userId) : process.env.EBAY_USER_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      'eBayアカウントが未接続です。設定タブから「eBayでログイン」を行ってください。'
    );
  }

  const tokenResponse = await axios.post(
    `${EBAY_BASE_URL}/identity/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
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

// =================================================================
// eBayユーザー名の取得 (Commerce Identity API)
// アカウント削除通知（username付きで届く）と接続情報を突き合わせるため、
// 「eBayでログイン」直後（authorization_code交換で得たaccess_token、AUTH_SCOPES同意済み）に
// 一度だけ呼び出しebay_connectionsに保存しておく。
// =================================================================
export async function getEbayUsername(accessToken) {
  const response = await axios.get(`${EBAY_IDENTITY_BASE_URL}/commerce/identity/v1/user/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data?.username ?? null;
}
