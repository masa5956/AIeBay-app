import { useEffect, useState } from 'react';

interface ReauthPasswordModalProps {
  open: boolean;
  isSubmitting: boolean;
  error: string;
  onDismiss: () => void;
  onSubmit: (password: string) => void;
}

// 住所の表示/編集の前に本人確認を挟むためのパスワード再入力モーダル。
// SettingsPanel.tsx既存のconfirmingSwitchEnvインライン確認モーダルと同型のUIを一般化したもの。
export default function ReauthPasswordModal({ open, isSubmitting, error, onDismiss, onSubmit }: ReauthPasswordModalProps) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (open) setPassword('');
  }, [open]);

  if (!open) return null;

  const handleSubmit = () => {
    if (!password || isSubmitting) return;
    onSubmit(password);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-3 shadow-xl">
        <p className="text-sm font-bold text-slate-700 text-center">パスワードを再入力してください</p>
        <p className="text-xs text-slate-400 text-center">住所を表示・編集するには本人確認が必要です</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="パスワード"
          className="w-full border border-slate-200 rounded-lg px-3 py-2"
          autoFocus
        />
        {error && <p className="text-red-500 text-[10px]">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onDismiss} className="w-1/2 border py-2 rounded-lg text-xs font-bold text-slate-600">
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !password}
            className="w-1/2 bg-slate-800 text-white py-2 rounded-lg text-xs font-bold disabled:opacity-50"
          >
            {isSubmitting ? '確認中...' : '確認する'}
          </button>
        </div>
      </div>
    </div>
  );
}
