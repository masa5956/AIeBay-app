import type { CategoryAspectDef } from '../types/listing';

// 商品仕様(key)が、選択中カテゴリーのItem Specifics定義上「必須」かどうかを判定する。
// 必須フラグをaspect側に保存する設計だと、カテゴリーを切り替えても前のカテゴリーの必須フラグが
// 残ってしまう不具合になるため、常に選択中カテゴリーの最新定義(categoryAspectDefs)から都度算出する。
export function isAspectRequired(categoryAspectDefs: CategoryAspectDef[] | undefined, key: string): boolean {
  if (!categoryAspectDefs || !key) return false;
  const normalizedKey = key.toLowerCase();
  return categoryAspectDefs.some((d) => d.required && d.name.toLowerCase() === normalizedKey);
}
