import Parser from 'rss-parser';

const parser = new Parser({ timeout: 10000 });

// カテゴリごとのRSS取得元。「コスメ」は各社サイトに安定したRSSが見当たらなかったため、
// Google ニュースの検索結果RSSで代替している（Googleの利用規約上、個人のフィードリーダーでの
// 非商用利用を想定した提供であることに留意。本番投入前に他の情報源への差し替えを検討すること）。
const CATEGORY_FEEDS = {
  cosmetics: [
    {
      source: 'Google ニュース',
      url: 'https://news.google.com/rss/search?q=%E3%82%B3%E3%82%B9%E3%83%A1%20(%E6%96%B0%E8%89%B2%20OR%20%E6%96%B0%E7%99%BA%E5%A3%B2)&hl=ja&gl=JP&ceid=JP:ja',
    },
  ],
  games: [{ source: 'Game*Spark', url: 'https://www.gamespark.jp/rss/index.rdf' }],
  gadgets: [
    { source: 'ITmedia PC USER', url: 'https://rss.itmedia.co.jp/rss/2.0/pcuser.xml' },
    { source: 'Gizmodo Japan', url: 'https://www.gizmodo.jp/feed/index.xml' },
  ],
};

export const RESEARCH_CATEGORIES = Object.keys(CATEGORY_FEEDS);

// 指定カテゴリの最新記事一覧を取得する（複数フィードを並列取得→日付降順にマージ）。
// 1つのフィード取得に失敗しても他のフィードの結果は返す(Promise.allSettled)。
export async function getResearchArticles(category) {
  const feeds = CATEGORY_FEEDS[category];
  if (!feeds) {
    throw new Error(`未対応のカテゴリです: ${category}`);
  }

  const results = await Promise.allSettled(
    feeds.map(async ({ source, url }) => {
      const feed = await parser.parseURL(url);
      return (feed.items || []).map((item) => ({
        title: item.title || '',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || '',
        source,
      }));
    })
  );

  results
    .filter((r) => r.status === 'rejected')
    .forEach((r) => console.error('リサーチフィードの取得に失敗しました:', r.reason?.message || r.reason));

  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((article) => article.title && article.link)
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .slice(0, 30);
}
