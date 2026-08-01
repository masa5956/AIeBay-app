interface CancelConfirmDialogProps {
  open: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

// 出品作業キャンセルの確認ダイアログ
export default function CancelConfirmDialog({ open, onDismiss, onConfirm }: CancelConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl p-5 w-full max-w-xs space-y-4 shadow-xl text-center">
        <p className="text-sm font-bold text-slate-700">出品作業をキャンセルしますか？</p>
        <p className="text-xs text-slate-400">入力した内容は破棄されます</p>
        <div className="flex gap-2">
          <button onClick={onDismiss} className="w-1/2 border py-2 rounded-lg text-xs font-bold text-slate-600">
            戻る
          </button>
          <button onClick={onConfirm} className="w-1/2 bg-red-600 text-white py-2 rounded-lg text-xs font-bold">
            キャンセルする
          </button>
        </div>
      </div>
    </div>
  );
}
