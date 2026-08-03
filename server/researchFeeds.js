import axios from 'axios';

// NewsData.io: 無料枠でも商用利用が明示的に許可されているニュースAPI
// （GNews/Mediastack等の無料枠は非商用限定、Google ニュース検索RSSも個人利用限定のため不採用）。
// 取得手順: https://newsdata.io/register でサインアップ→メール確認→ダッシュボードでAPIキー発行、
// NEWSDATA_API_KEYとして.env(本番はRenderの環境変数)に設定する。無料枠は200クレジット/日、
// 記事は12時間遅延、キーワードは100文字まで、レート制限30クレジット/15分。
const NEWSDATA_LATEST_URL = 'https://newsdata.io/api/1/latest';

// 任意のキーワードで記事を検索する。固定カテゴリも自由検索も、内部的には同じ
// 「キーワード→NewsData.io検索」の仕組みを使う（カテゴリ＝検索クエリのラベル付けに過ぎないため、
// 新しいカテゴリの追加はフロントエンド側でクエリ文字列を1つ増やすだけで済む）。
export async function searchResearchArticles(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    throw new Error('検索キーワードを入力してください');
  }

  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'NEWSDATA_API_KEYが未設定です。https://newsdata.io/register でAPIキーを取得し.envに設定してください。'
    );
  }

  const response = await axios.get(NEWSDATA_LATEST_URL, {
    params: {
      apikey: apiKey,
      q: trimmed.slice(0, 100), // 無料枠はクエリ100文字まで
      language: 'ja',
      country: 'jp',
    },
    timeout: 10000,
  });

  const results = response.data?.results || [];
  return results
    .map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: item.source_name || item.source_id || 'NewsData.io',
    }))
    .filter((article) => article.title && article.link)
    .slice(0, 30);
}
