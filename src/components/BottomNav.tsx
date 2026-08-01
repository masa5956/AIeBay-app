import { Home, BarChart2, Settings } from 'lucide-react';
import type { TabType } from '../types/app';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

// 画面下部のタブナビゲーション（lucide-reactアイコン使用）
export default function BottomNav({ activeTab, onChangeTab }: BottomNavProps) {
  const items: { tab: TabType; label: string; Icon: typeof Home }[] = [
    { tab: 'home', label: 'ホーム', Icon: Home },
    { tab: 'analytics', label: '分析', Icon: BarChart2 },
    { tab: 'settings', label: '設定', Icon: Settings },
  ];

  return (
    <nav className="absolute bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur border-t border-slate-200 flex justify-around items-center px-4 z-10 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
      {items.map(({ tab, label, Icon }) => (
        <button
          key={tab}
          onClick={() => onChangeTab(tab)}
          className={`flex flex-col items-center gap-1 transition-colors ${
            activeTab === tab ? 'text-blue-600' : 'text-slate-400 hover:text-slate-500'
          }`}
        >
          <Icon size={20} strokeWidth={activeTab === tab ? 2.5 : 2} />
          <span className="text-[10px] font-bold">{label}</span>
        </button>
      ))}
    </nav>
  );
}
