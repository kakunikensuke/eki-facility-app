// 住みやすさ駅前スコア（2026-09-29版）の分野と施設の定義。
//
// 採点そのものは backend/livability.js が持つ。ブラウザ側はバックエンド（CommonJS）を
// 読み込めないので表示に要る分だけここに複製し、ずれていないかは scripts/generateApiData.js が
// ビルドのたびに突き合わせる（ずれていたらビルドを止める）。
// プリレンダ（scripts/prerender.js）もここを使うので拡張子まで明示すること。

export const DOMAINS = [
  { key: "shopping", label: "買い物", lead: "日用品と食料品の買いやすさ", color: "#e0843a" },
  { key: "dining", label: "食事", lead: "外食とカフェの選択肢", color: "#d4a017" },
  { key: "medical", label: "医療", lead: "通院と薬の受け取りやすさ", color: "#d65a7e" },
  { key: "family", label: "子育て・教育", lead: "保育・学校・図書館", color: "#7b68d6" },
  { key: "services", label: "生活・安全", lead: "郵便・お金・洗濯と交番", color: "#3a86c8" },
  { key: "leisure", label: "自然・余暇", lead: "公園と運動・お風呂", color: "#3a9a6a" },
];

export const ITEMS = [
  { key: "convenience_store", label: "コンビニ", domain: "shopping" },
  { key: "supermarket", label: "スーパー", domain: "shopping" },
  { key: "drugstore", label: "ドラッグストア", domain: "shopping" },
  { key: "variety_store", label: "100円ショップ", domain: "shopping" },
  { key: "restaurant_only", label: "飲食店", note: "ファストフードを含む・カフェを除く", domain: "dining" },
  { key: "cafe", label: "カフェ", domain: "dining" },
  { key: "hospital", label: "病院・クリニック", domain: "medical" },
  { key: "dentist", label: "歯科", domain: "medical" },
  { key: "pharmacy", label: "調剤薬局", domain: "medical" },
  { key: "nursery", label: "保育園・幼稚園", domain: "family" },
  { key: "school", label: "学校", note: "小・中・高を区別しない", domain: "family" },
  { key: "library", label: "図書館", domain: "family" },
  { key: "post_office", label: "郵便局", domain: "services" },
  { key: "bank", label: "銀行・ATM", domain: "services" },
  { key: "laundry", label: "コインランドリー", domain: "services" },
  { key: "police", label: "交番・警察署", domain: "services" },
  { key: "park", label: "公園", domain: "leisure" },
  { key: "fitness", label: "ジム", domain: "leisure" },
  { key: "public_bath", label: "銭湯", domain: "leisure" },
];

export const MAX_TOTAL = 1000;

export const domainOf = (key) => DOMAINS.find((d) => d.key === key);
export const itemOf = (key) => ITEMS.find((i) => i.key === key);
export const itemsOfDomain = (key) => ITEMS.filter((i) => i.domain === key);

// 地価（円/m²）の表示。「85.5万円」のように万円単位で小数1桁まで
export function formatYenPerM2(yen) {
  if (yen >= 10000) return `${(Math.round(yen / 1000) / 10).toLocaleString()}万円`;
  return `${yen.toLocaleString()}円`;
}

// 乗降客数の表示。「約236万人」「約8.2万人」「約4,500人」
export function formatPeople(n) {
  if (n >= 1000000) return `約${Math.round(n / 10000).toLocaleString()}万人`;
  if (n >= 10000) return `約${(Math.round(n / 1000) / 10).toLocaleString()}万人`;
  return `約${(Math.round(n / 100) * 100).toLocaleString()}人`;
}
