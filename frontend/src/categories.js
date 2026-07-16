// カテゴリキー(backend/batch/updateFacilityCounts.jsのCATEGORY_TAGSと一致させる規約)と表示情報
// CATEGORIES: 住みやすさスコア(scoring.js)の算出対象となる4カテゴリ
export const CATEGORIES = [
  { key: "convenience_store", label: "コンビニ", icon: "🏪" },
  { key: "supermarket", label: "スーパー", icon: "🛒" },
  { key: "hospital", label: "病院", icon: "🏥", note: "クリニックを含む" },
  { key: "restaurant", label: "飲食店", icon: "🍴", note: "カフェ・ファストフードを含む" },
];

// EXTRA_CATEGORIES: 2026-07-16追加。表示のみでスコアには含めない（要件定義書8.1参照）
export const EXTRA_CATEGORIES = [
  { key: "drugstore", label: "ドラッグストア", icon: "💊" },
  { key: "park", label: "公園", icon: "🌳" },
  { key: "nursery", label: "保育園・幼稚園", icon: "👶" },
];
