import axios from 'axios';

// Serper.dev: Googleニュースの検索結果を返すAPI。Currents APIは無料枠こそ商用利用可・
// 制限も緩いが、実際に試すと日本語ニュースのカバレッジが薄く「ゲームで検索して1件しか
// 出ない」レベルだったため不採用。Serper.devはGoogleの検索結果を有償で仲介するサービスで、
// この再配信・商用利用自体が正式に許可されたビジネスモデルのため、Googleニュースを直接
// スクレイピングする場合の利用規約上の曖昧さを避けつつ同等の網羅性が得られる。
// 取得手順: https://serper.dev/ でサインアップ（クレカ不要、無料2,500クエリ付与）→
// ダッシュボードでAPIキーを発行し、SERPER_API_KEYとして.envに設定する。
// 無料枠を使い切った場合も$50で50,000クエリ追加と非常に安価。
const SERPER_NEWS_URL = 'https://google.serper.dev/news';

// 任意のキーワードで記事を検索する。固定カテゴリも自由検索も、内部的には同じ
// 「キーワード→Serper.dev(Googleニュース)検索」の仕組みを使う（カテゴリ＝検索クエリの
// ラベル付けに過ぎないため、新しいカテゴリの追加はフロントエンド側でクエリ文字列を
// 1つ増やすだけで済む）。
export async function searchResearchArticles(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    throw new Error('検索キーワードを入力してください');
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEYが未設定です。https://serper.dev/ でAPIキーを取得し.envに設定してください。');
  }

  const response = await axios.post(
    SERPER_NEWS_URL,
    { q: trimmed, gl: 'jp', hl: 'ja' },
    {
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  );

  const news = response.data?.news || [];
  return news
    .map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.date || '',
      source: item.source || 'Google ニュース',
    }))
    .filter((article) => article.title && article.link)
    .slice(0, 30);
}
