import { useState } from 'react';
import { supabase } from '../services/supabaseClient';

// アプリ自体のアカウント作成・ログイン画面（Supabase Auth、メールアドレス+パスワード方式）。
// ログイン成功後はApp.tsx側のonAuthStateChangeがセッションを検知しメイン画面へ切り替わる。
export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [signupDone, setSignupDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // ログイン成功後、フォーカスされたまま入力欄がアンマウントされると、モバイルSafari等が
    // フォーカスズームをリセットできず画面がズームしたまま固定されることがあるため、
    // 非同期処理を始める前に明示的にフォーカスを外しキーボード/ズームを閉じておく
    (document.activeElement as HTMLElement | null)?.blur();
    setIsLoading(true);
    setError('');

    if (mode === 'signup') {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setSignupDone(true);
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
      }
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen min-h-dvh bg-slate-900 text-slate-100 flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-slate-50 text-slate-800 min-h-screen min-h-dvh flex flex-col justify-center shadow-2xl px-6">
        <div className="space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-black text-slate-800">eBay AI Lister</h1>
            <p className="text-xs text-slate-400">{mode === 'login' ? 'ログイン' : 'アカウント作成'}</p>
          </div>

          {signupDone ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center space-y-2">
              <p className="text-sm font-bold text-emerald-700">確認メールを送信しました</p>
              <p className="text-xs text-emerald-600">
                メール内のリンクを開いて確認を完了してから、ログインしてください。
              </p>
              <button
                onClick={() => {
                  setSignupDone(false);
                  setMode('login');
                }}
                className="text-xs font-bold text-blue-600 hover:underline"
              >
                ログイン画面へ
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-500">メールアドレス</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-200 p-2.5 rounded-lg text-base mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">パスワード</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-slate-200 p-2.5 rounded-lg text-base mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-3 rounded-lg hover:from-blue-700 hover:to-blue-600 transition disabled:opacity-50"
              >
                {isLoading ? '処理中...' : mode === 'login' ? 'ログイン' : 'アカウント作成'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                }}
                className="w-full text-xs text-slate-500 hover:underline"
              >
                {mode === 'login' ? 'アカウントをお持ちでない方はこちら' : 'すでにアカウントをお持ちの方はこちら'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
