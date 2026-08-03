import axios from 'axios';

// Currents API: 無料枠でも商用利用が明示的に許可されているニュースAPI。無料1,000リクエスト/日
// （NewsData.ioの200クレジット/日の5倍）かつ配信遅延が原則なし（NewsData.io無料枠は12時間遅延）
// という理由でこちらに切替（NewsData.ioからの移行時に比較検討済み）。
// 取得手順: https://currentsapi.services/ でサインアップ（クレカ不要）→ダッシュボードでAPIキー発行、
// CURRENTS_API_KEYとして.env(本番はRenderの環境変数)に設定する。
const CURRENTS_SEARCH_URL = 'https://api.currentsapi.services/v1/search';

// 任意のキーワードで記事を検索する。固定カテゴリも自由検索も、内部的には同じ
// 「キーワード→Currents API検索」の仕組みを使う（カテゴリ＝検索クエリのラベル付けに過ぎないため、
// 新しいカテゴリの追加はフロントエンド側でクエリ文字列を1つ増やすだけで済む）。
export async function searchResearchArticles(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    throw new Error('検索キーワードを入力してください');
  }

  const apiKey = process.env.CURRENTS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'CURRENTS_API_KEYが未設定です。https://currentsapi.services/ でAPIキーを取得し.envに設定してください。'
    );
  }

  const response = await axios.get(CURRENTS_SEARCH_URL, {
    params: {
      apiKey,
      keywords: trimmed,
      language: 'ja',
    },
    timeout: 10000,
  });

  const news = response.data?.news || [];
  return news
    .map((item) => ({
      title: item.title || '',
      link: item.url || '',
      pubDate: item.published || '',
      source: item.author || 'Currents',
    }))
    .filter((article) => article.title && article.link)
    .slice(0, 30);
}
