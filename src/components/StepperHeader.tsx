interface StepperHeaderProps {
  step: number;
  hasProductData: boolean;
  onGoToStep: (step: number) => void;
}

// 出品ウィザードのステップ進捗バー（クリックで各ステップへ移動可能）
export default function StepperHeader({ step, hasProductData, onGoToStep }: StepperHeaderProps) {
  const steps = [
    { num: 1, label: '撮影' },
    { num: 2, label: '解析' },
    { num: 3, label: '価格' },
    { num: 4, label: '出品' },
  ];

  return (
    <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b pb-2">
      {steps.map(({ num, label }, i) => (
        <div key={num} className="flex items-center">
          <button
            onClick={() => onGoToStep(num)}
            disabled={num > 1 && !hasProductData}
            className={`${step >= num ? 'text-blue-600' : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {num}. {label}
          </button>
          {i < steps.length - 1 && <span className="mx-1.5">&gt;</span>}
        </div>
      ))}
    </div>
  );
}
