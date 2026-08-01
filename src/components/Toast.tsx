export type Feedback = { type: 'success' | 'error'; message: string };

interface ToastProps {
  feedback: Feedback | null;
  onClose: () => void;
}

// 完了・失敗を知らせるトースト通知
export default function Toast({ feedback, onClose }: ToastProps) {
  if (!feedback) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] animate-[fadeIn_0.2s_ease-out]">
      <div
        className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg text-white ${
          feedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}
      >
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
          {feedback.type === 'success' ? '✓' : '✕'}
        </div>
        <p className="text-xs font-semibold flex-1">{feedback.message}</p>
        <button
          onClick={onClose}
          className="flex-shrink-0 text-white/70 hover:text-white text-xs font-bold"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
