import axios from 'axios';
import { getEbayEnvConfig, getAppAccessToken } from './ebayAuth.js';

// eBay Taxonomy API（commerce/taxonomy/v1）— カテゴリー体系・カテゴリー別Item Specificsの
// 権威あるソース。第三者サイトからの手動カタログ化ではなくこちらを使うことで、eBayの
// カテゴリー改定に追従し続ける保守コストを避ける。ユーザー認可不要なためアプリトークンで呼び出す。
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6時間（カテゴリー体系は頻繁には変わらないため）

const treeIdCache = new Map(); // environment -> { value, expiresAt }
const suggestionsCache = new Map(); // `${environment}:${query}` -> { value, expiresAt }
const aspectsCache = new Map(); // `${environment}:${categoryId}` -> { value, expiresAt }

function getCached(cache, key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.value;
  return null;
}

function setCached(cache, key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// EBAY_USの既定カテゴリーツリーID（実質固定値だが、将来の他マーケットプレイス対応に備えAPI経由で取得する）
export async function getDefaultCategoryTreeId(environment) {
  const cached = getCached(treeIdCache, environment);
  if (cached) return cached;

  const { baseUrl } = getEbayEnvConfig(environment);
  const appToken = await getAppAccessToken(environment);
  const response = await axios.get(`${baseUrl}/commerce/taxonomy/v1/get_default_category_tree_id`, {
    headers: { Authorization: `Bearer ${appToken}` },
    params: { marketplace_id: 'EBAY_US' },
  });
  const treeId = response.data.categoryTreeId;
  setCached(treeIdCache, environment, treeId);
  return treeId;
}

// 商品タイトル等のキーワードから、eBayカテゴリー候補を取得する（自動確定はせず、必ずユーザーに選ばせる）
export async function getCategorySuggestions(environment, keywords) {
  const cacheKey = `${environment}:${keywords}`;
  const cached = getCached(suggestionsCache, cacheKey);
  if (cached) return cached;

  const treeId = await getDefaultCategoryTreeId(environment);
  const { baseUrl } = getEbayEnvConfig(environment);
  const appToken = await getAppAccessToken(environment);
  const response = await axios.get(
    `${baseUrl}/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions`,
    {
      headers: { Authorization: `Bearer ${appToken}` },
      params: { q: keywords },
    }
  );

  const suggestions = (response.data.categorySuggestions || []).map((s) => ({
    categoryId: s.category?.categoryId,
    categoryName: s.category?.categoryName,
  })).filter((s) => s.categoryId && s.categoryName);

  setCached(suggestionsCache, cacheKey, suggestions);
  return suggestions;
}

// 指定カテゴリー（リーフカテゴリー）のItem Specifics定義一覧を取得する。
// aspectConstraint.aspectRequired===trueが「出品時に必須」の項目。
export async function getItemAspectsForCategory(environment, categoryId) {
  const cacheKey = `${environment}:${categoryId}`;
  const cached = getCached(aspectsCache, cacheKey);
  if (cached) return cached;

  const treeId = await getDefaultCategoryTreeId(environment);
  const { baseUrl } = getEbayEnvConfig(environment);
  const appToken = await getAppAccessToken(environment);
  const response = await axios.get(
    `${baseUrl}/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category`,
    {
      headers: { Authorization: `Bearer ${appToken}` },
      params: { category_id: categoryId },
    }
  );

  const aspects = (response.data.aspects || []).map((a) => ({
    name: a.localizedAspectName,
    required: a.aspectConstraint?.aspectRequired === true,
    mode: a.aspectConstraint?.aspectMode || 'FREE_TEXT',
    cardinality: a.aspectConstraint?.itemToAspectCardinality || 'SINGLE',
    allowedValues: (a.aspectValues || []).map((v) => v.localizedValue).filter(Boolean),
  })).filter((a) => a.name);

  setCached(aspectsCache, cacheKey, aspects);
  return aspects;
}
