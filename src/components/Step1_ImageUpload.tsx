import { useEffect, useState } from 'react';
import { Camera, Plus, X } from 'lucide-react';

interface Step1ImageUploadProps {
  onConfirm: (files: File[]) => void;
  maxPhotos: number;
}

// Step 1: 商品写真の撮影・選択（複数枚可。角度違いの写真をまとめて選ぶとAIが1つの商品情報に統合する）。
// 選択直後にAI解析を始めてしまうと、誤った写真のまま解析されてもやり直しにくいため、
// 一度サムネイルで確認・個別削除・追加ができる状態を挟んでから、明示的な操作で解析を開始する。
export default function Step1_ImageUpload({ onConfirm, maxPhotos }: Step1ImageUploadProps) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // pendingFilesが変わるたびにプレビュー用URLを作り直し、古いものは確実に解放する
  useEffect(() => {
    const urls = pendingFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [pendingFiles]);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    e.target.value = ''; // 同じファイルを連続選択してもonChangeが発火するようにリセット
    if (newFiles.length === 0) return;
    setPendingFiles((prev) => [...prev, ...newFiles].slice(0, maxPhotos));
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const hasPending = pendingFiles.length > 0;

  return (
    <div className="space-y-4">
      {!hasPending ? (
        <div className="text-center py-6">
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 bg-slate-50 space-y-4">
            <Camera size={40} className="mx-auto text-slate-400" />
            <p className="text-xs text-slate-500">
              商品のラベルや型番が見えるように撮影してください（複数枚選択可）
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleSelect}
              className="hidden"
              id="camera-input-wizard"
            />
            <label
              htmlFor="camera-input-wizard"
              className="cursor-pointer bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-3 px-6 rounded-lg shadow hover:from-blue-700 hover:to-blue-600 transition block text-sm"
            >
              カメラを起動 / 写真を選択
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-sm font-bold text-slate-700">この写真でよろしいですか？</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              間違った写真は×で削除、必要なら追加してから解析を開始してください
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {previewUrls.map((url, i) => (
              <div key={i} className="relative">
                <img
                  src={url}
                  alt={`選択した写真 ${i + 1}`}
                  className="w-20 h-20 object-cover rounded-lg border border-slate-200"
                />
                <button
                  onClick={() => removeFile(i)}
                  aria-label="この写真を削除"
                  className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full p-0.5 shadow"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {pendingFiles.length < maxPhotos && (
              <label
                htmlFor="camera-input-wizard"
                className="w-20 h-20 flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 cursor-pointer hover:border-blue-400 hover:text-blue-500 transition"
              >
                <Plus size={18} />
                <span className="text-[9px] font-bold">追加</span>
              </label>
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleSelect}
              className="hidden"
              id="camera-input-wizard"
            />
          </div>

          <button
            onClick={() => onConfirm(pendingFiles)}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-3 rounded-lg shadow hover:from-blue-700 hover:to-blue-600 transition text-sm"
          >
            この写真で解析する（{pendingFiles.length}枚）
          </button>
        </div>
      )}
    </div>
  );
}
