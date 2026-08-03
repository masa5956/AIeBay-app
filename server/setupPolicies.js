import dotenv from 'dotenv';
import axios from 'axios';
import { getEbayEnvConfig, getUserAccessToken } from './ebayAuth.js';
import { updateEnvValue } from './envFile.js';

dotenv.config();

const MARKETPLACE_ID = 'EBAY_US';

// Business Policy機能(Selling Policy Management)へのオプトイン。
// 新規作成したSandboxテストユーザーはデフォルトで無効になっており、
// 有効化しないままポリシー作成APIを呼ぶと「User is not eligible for Business Policy」エラーになる。
export async function ensureBusinessPolicyOptIn(token, environment) {
  const { baseUrl } = getEbayEnvConfig(environment);
  try {
    await axios.post(
      `${baseUrl}/sell/account/v1/program/opt_in`,
      { programType: 'SELLING_POLICY_MANAGEMENT' },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('Business Policy(SELLING_POLICY_MANAGEMENT)へのオプトインが完了しました。');
  } catch (err) {
    // 既にオプトイン済みの場合はエラーになることがある（eBay側のエラーIDが状況により複数存在するため、
    // 個別のIDだけでなくメッセージ内容からも判定する）。その場合は無視して続行する。
    const errorMessage = err?.response?.data?.errors?.[0]?.message || '';
    const alreadyOptedIn = /already/i.test(errorMessage);
    if (alreadyOptedIn) {
      console.log('既にBusiness Policyへオプトイン済みです。');
      return;
    }
    throw err;
  }
}

// 配送ポリシーを取得、無ければ最低限の内容で新規作成する
export async function ensureFulfillmentPolicy(token, environment) {
  const { baseUrl } = getEbayEnvConfig(environment);
  const listRes = await axios.get(`${baseUrl}/sell/account/v1/fulfillment_policy`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { marketplace_id: MARKETPLACE_ID },
  });

  const existing = listRes.data.fulfillmentPolicies?.[0];
  if (existing) {
    console.log(`既存の配送ポリシーを使用します: ${existing.fulfillmentPolicyId}`);
    return existing.fulfillmentPolicyId;
  }

  const createRes = await axios.post(
    `${baseUrl}/sell/account/v1/fulfillment_policy`,
    {
      name: 'eBay AI Lister Default Shipping',
      marketplaceId: MARKETPLACE_ID,
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      handlingTime: { value: 3, unit: 'DAY' },
      shippingOptions: [
        {
          optionType: 'DOMESTIC',
          costType: 'FLAT_RATE',
          shippingServices: [
            {
              sortOrder: 1,
              shippingServiceCode: 'USPSPriority',
              shippingCost: { value: '0.00', currency: 'USD' },
              freeShipping: true,
            },
          ],
        },
      ],
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  console.log(`配送ポリシーを新規作成しました: ${createRes.data.fulfillmentPolicyId}`);
  return createRes.data.fulfillmentPolicyId;
}

// 返品ポリシーを取得、無ければ最低限の内容で新規作成する
export async function ensureReturnPolicy(token, environment) {
  const { baseUrl } = getEbayEnvConfig(environment);
  const listRes = await axios.get(`${baseUrl}/sell/account/v1/return_policy`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { marketplace_id: MARKETPLACE_ID },
  });

  const existing = listRes.data.returnPolicies?.[0];
  if (existing) {
    console.log(`既存の返品ポリシーを使用します: ${existing.returnPolicyId}`);
    return existing.returnPolicyId;
  }

  const createRes = await axios.post(
    `${baseUrl}/sell/account/v1/return_policy`,
    {
      name: 'eBay AI Lister Default Returns',
      marketplaceId: MARKETPLACE_ID,
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: 'DAY' },
      returnShippingCostPayer: 'BUYER',
      refundMethod: 'MONEY_BACK',
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  console.log(`返品ポリシーを新規作成しました: ${createRes.data.returnPolicyId}`);
  return createRes.data.returnPolicyId;
}

// 出荷元ロケーションを取得、無ければ渡された住所情報から新規作成する。
// まずそのeBayアカウントに既存の有効なロケーションが無いか確認する（ユーザーがSeller Hubで
// 既に作成済みならそれをそのまま使う＝アプリ側での住所の収集を避けられる）。無ければ、
// ユーザーごとに設定タブで入力・暗号化保存された住所(userSettingsRepository.js、
// addressCrypto.jsでAES-256-GCM暗号化)からロケーションを新規作成する。
// SandboxとProductionは完全に別のeBayアカウント空間のため、同じキー名でも衝突しない。
export async function ensureMerchantLocation(token, environment, address) {
  const { baseUrl } = getEbayEnvConfig(environment);

  const listRes = await axios.get(`${baseUrl}/sell/inventory/v1/location`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { limit: 100 },
  });
  const existing = (listRes.data?.locations || []).find(
    (loc) => loc.merchantLocationStatus === 'ENABLED'
  );

  if (existing) {
    console.log(`既存の出荷元ロケーションを使用します: ${existing.merchantLocationKey}`);
    return existing.merchantLocationKey;
  }

  if (!address?.addressLine1 || !address?.city || !address?.postalCode || !address?.country) {
    // 以前はここで警告ログのみ出してmerchantLocationKeyを返していたため、実際にはeBay側に
    // ロケーションを作成していないのに呼び出し元(setEbayConnection)が「成功した」として
    // このキーをDBに保存してしまい、出品時にerrorId 25002/25805（Location not found）になる
    // 不具合があった。作成できなかった場合は例外を投げ、DBに嘘の値を保存させないようにする。
    throw new Error(
      `出荷元ロケーションがeBay側に存在せず、かつ新規作成もできません。` +
      '設定タブで出荷元住所を入力してから、「eBayでログイン」をやり直してください。'
    );
  }

  const merchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'DEFAULT_LOCATION';
  await axios.post(
    `${baseUrl}/sell/inventory/v1/location/${merchantLocationKey}`,
    {
      name: 'eBay AI Lister Default Location',
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
      location: {
        address: {
          addressLine1: address.addressLine1,
          city: address.city,
          stateOrProvince: address.stateOrProvince || undefined,
          postalCode: address.postalCode,
          country: address.country,
        },
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  console.log(`出荷元ロケーションを新規作成しました: ${merchantLocationKey}`);
  return merchantLocationKey;
}

// 指定したアクセストークン・環境のeBayアカウントに対し、Business Policies・出荷元ロケーションを
// 一括セットアップする（get-or-createなので何度呼んでも安全）。
// アプリ内「eBayでログイン」の直後に自動実行される他、npm run setup:policiesからも呼ばれる。
export async function setupEbayPoliciesForToken(token, environment, address) {
  await ensureBusinessPolicyOptIn(token, environment);
  const fulfillmentPolicyId = await ensureFulfillmentPolicy(token, environment);
  const returnPolicyId = await ensureReturnPolicy(token, environment);
  const merchantLocationKey = await ensureMerchantLocation(token, environment, address);
  return { fulfillmentPolicyId, returnPolicyId, merchantLocationKey };
}

// npm run setup:policies から直接実行された場合のみ動作する
// （.envのEBAY_USER_REFRESH_TOKENを使ったローカル動作確認・旧来の手動セットアップ用。
//   環境は.envのEBAY_ENV、未指定ならSANDBOX扱い）
async function main() {
  const environment = process.env.EBAY_ENV === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  console.log(`eBay Business Policies / 出荷元ロケーションのセットアップを開始します...（環境: ${environment}）`);
  const token = await getUserAccessToken(undefined, environment);
  // このスクリプトはアプリのDB(user_settings)を介さないローカル手動実行専用のため、
  // 住所は.envのEBAY_LOCATION_*から組み立てる（アプリ本体は設定タブでユーザーごとに入力する）。
  const address = {
    addressLine1: process.env.EBAY_LOCATION_ADDRESS_LINE1,
    city: process.env.EBAY_LOCATION_CITY,
    stateOrProvince: process.env.EBAY_LOCATION_STATE_OR_PROVINCE,
    postalCode: process.env.EBAY_LOCATION_POSTAL_CODE,
    country: process.env.EBAY_LOCATION_COUNTRY || 'US',
  };
  const { fulfillmentPolicyId, returnPolicyId } = await setupEbayPoliciesForToken(token, environment, address);

  updateEnvValue('EBAY_FULFILLMENT_POLICY_ID', fulfillmentPolicyId);
  updateEnvValue('EBAY_RETURN_POLICY_ID', returnPolicyId);

  console.log('.env に EBAY_FULFILLMENT_POLICY_ID / EBAY_RETURN_POLICY_ID を保存しました。');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error('セットアップに失敗しました:', error?.response?.data || error);
    process.exit(1);
  });
}
