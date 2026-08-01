import { supabase } from './supabaseClient.js';

// フロントエンドが送ってくる `Authorization: Bearer <supabase access_token>` を検証し、
// req.userId にログイン中のユーザーIDをセットする。データをユーザーごとに分離するための
// 全APIエンドポイント共通の認証ミドルウェア。
export async function requireAuth(req, res, next) {
  if (!supabase) {
    return res.status(500).json({ error: 'Supabaseが設定されていないため認証を利用できません。' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'ログインが必要です。' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'セッションが無効です。再度ログインしてください。' });
  }

  req.userId = data.user.id;
  next();
}
