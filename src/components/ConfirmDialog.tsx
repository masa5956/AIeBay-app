interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  confirmClassName?: string;
  onDismiss: () => void;
  onConfirm: () => void;
}

// 汎用の確認ダイアログ。「出品作業のキャンセル(入力破棄)」「出品済み商品のキャンセル」など、
// このアプリ内で複数の意味を持つ「キャンセル」操作それぞれに、文言だけ変えて使い回す
// （専用ダイアログを複数持つより保守コストが低いため）。
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmClassName = 'bg-red-600',
  onDismiss,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-4 shadow-xl text-center">
        <p className="text-sm font-bold text-slate-700">{title}</p>
        {body && <p className="text-xs text-slate-400">{body}</p>}
        <div className="flex gap-2">
          <button onClick={onDismiss} className="w-1/2 border py-2 rounded-lg text-xs font-bold text-slate-600">
            戻る
          </button>
          <button onClick={onConfirm} className={`w-1/2 text-white py-2 rounded-lg text-xs font-bold ${confirmClassName}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
