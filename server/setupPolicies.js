import dotenv from 'dotenv';
import axios from 'axios';
import { EBAY_BASE_URL, getUserAccessToken } from './ebayAuth.js';
import { updateEnvValue } from './envFile.js';

dotenv.config();

const MARKETPLACE_ID = 'EBAY_US';

// 配送ポリシーを取得、無ければ最低限の内容で新規作成する
async function ensureFulfillmentPolicy(token) {
  const listRes = await axios.get(`${EBAY_BASE_URL}/sell/account/v1/fulfillment_policy`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { marketplace_id: MARKETPLACE_ID },
  });

  const existing = listRes.data.fulfillmentPolicies?.[0];
  if (existing) {
    console.log(`既存の配送ポリシーを使用します: ${existing.fulfillmentPolicyId}`);
    return existing.fulfillmentPolicyId;
  }

  const createRes = await axios.post(
    `${EBAY_BASE_URL}/sell/account/v1/fulfillment_policy`,
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
async function ensureReturnPolicy(token) {
  const listRes = await axios.get(`${EBAY_BASE_URL}/sell/account/v1/return_policy`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { marketplace_id: MARKETPLACE_ID },
  });

  const existing = listRes.data.returnPolicies?.[0];
  if (existing) {
    console.log(`既存の返品ポリシーを使用します: ${existing.returnPolicyId}`);
    return existing.returnPolicyId;
  }

  const createRes = await axios.post(
    `${EBAY_BASE_URL}/sell/account/v1/return_policy`,
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

// 出荷元ロケーションを取得、無ければ.envの住所情報から新規作成する
async function ensureMerchantLocation(token) {
  const merchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY || 'DEFAULT_LOCATION';

  const exists = await axios
    .get(`${EBAY_BASE_URL}/sell/inventory/v1/location/${merchantLocationKey}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(() => true)
    .catch((err) => {
      if (err?.response?.status === 404) return false;
      throw err;
    });

  if (exists) {
    console.log(`既存の出荷元ロケーションを使用します: ${merchantLocationKey}`);
    return;
  }

  const {
    EBAY_LOCATION_ADDRESS_LINE1,
    EBAY_LOCATION_CITY,
    EBAY_LOCATION_STATE_OR_PROVINCE,
    EBAY_LOCATION_POSTAL_CODE,
    EBAY_LOCATION_COUNTRY,
  } = process.env;

  if (!EBAY_LOCATION_ADDRESS_LINE1 || !EBAY_LOCATION_CITY || !EBAY_LOCATION_POSTAL_CODE) {
    console.warn(
      `出荷元ロケーション「${merchantLocationKey}」が存在しません。` +
      'EBAY_LOCATION_ADDRESS_LINE1 / EBAY_LOCATION_CITY / EBAY_LOCATION_STATE_OR_PROVINCE / ' +
      'EBAY_LOCATION_POSTAL_CODE / EBAY_LOCATION_COUNTRY を.envに設定して再実行するか、' +
      'eBay Seller Hubで手動作成してください。'
    );
    return;
  }

  await axios.post(
    `${EBAY_BASE_URL}/sell/inventory/v1/location/${merchantLocationKey}`,
    {
      name: 'eBay AI Lister Default Location',
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
      location: {
        address: {
          addressLine1: EBAY_LOCATION_ADDRESS_LINE1,
          city: EBAY_LOCATION_CITY,
          stateOrProvince: EBAY_LOCATION_STATE_OR_PROVINCE,
          postalCode: EBAY_LOCATION_POSTAL_CODE,
          country: EBAY_LOCATION_COUNTRY || 'US',
        },
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  console.log(`出荷元ロケーションを新規作成しました: ${merchantLocationKey}`);
}

async function main() {
  console.log('eBay Business Policies / 出荷元ロケーションのセットアップを開始します...');
  const token = await getUserAccessToken();

  const fulfillmentPolicyId = await ensureFulfillmentPolicy(token);
  const returnPolicyId = await ensureReturnPolicy(token);
  await ensureMerchantLocation(token);

  updateEnvValue('EBAY_FULFILLMENT_POLICY_ID', fulfillmentPolicyId);
  updateEnvValue('EBAY_RETURN_POLICY_ID', returnPolicyId);

  console.log('.env に EBAY_FULFILLMENT_POLICY_ID / EBAY_RETURN_POLICY_ID を保存しました。');
}

main().catch((error) => {
  console.error('セットアップに失敗しました:', error?.response?.data || error);
  process.exit(1);
});
