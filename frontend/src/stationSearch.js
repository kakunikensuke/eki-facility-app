// 「条件で駅を探す」「重視する項目で並べる」の計算（2026-09-29追加）。
//
// 駅ページは「行きたい駅が決まっている人」しか使えない。引っ越し先を探している人は
// まだ駅名を知らないので、「スーパーが5軒以上ある駅」「子育てに向く駅」のように
// 条件の側から駅を出せるようにする。
//
// 並べ方について:
// 住みやすさスコアは各カテゴリが上位25%で満点になる設計のため、徒歩10分では
// 39駅が100点で並んでしまい順位として機能しない。ここではカテゴリごとの
// 「全国の駅の中での位置（パーセンタイル）」を重み付きで平均する。軒数の桁が違う
// カテゴリ（飲食店は数百軒、病院は数軒）を同じ物差しで足し合わせられ、満点で頭打ちにもならない。
//
// React（pages/SearchPage.jsx・TopPage.jsx）とプリレンダ（scripts/prerender.js）の
// 両方から使うので、拡張子まで明示すること。
import { CATEGORIES, EXTRA_CATEGORIES } from "./categories.js";

export const SEARCH_CATEGORIES = [...CATEGORIES, ...EXTRA_CATEGORIES];

// 目的別の重み。0=考えない、1=少し、2=重視、3=最重視（WEIGHT_LEVELSと対応）
export const PRESETS = [
  {
    key: "balance",
    label: "バランス重視",
    lead: "コンビニ・スーパー・病院・飲食店の4つを同じ重さで見ます",
    weights: { convenience_store: 2, supermarket: 2, hospital: 2, restaurant: 2 },
  },
  {
    key: "single",
    label: "一人暮らし",
    lead: "コンビニと飲食店を重く、スーパーとドラッグストアを少し見ます",
    weights: { convenience_store: 3, restaurant: 3, supermarket: 1, drugstore: 1 },
  },
  {
    key: "cooking",
    label: "自炊・まとめ買い",
    lead: "スーパーを最も重く、ドラッグストアとコンビニも見ます",
    weights: { supermarket: 3, drugstore: 2, convenience_store: 1 },
  },
  {
    key: "family",
    label: "子育て",
    lead: "公園と保育園・幼稚園を最も重く、病院とスーパーも見ます",
    weights: { park: 3, nursery: 3, hospital: 2, supermarket: 1 },
  },
  {
    key: "medical",
    label: "医療の近さ",
    lead: "病院（クリニックを含む）を最も重く、ドラッグストアも見ます",
    weights: { hospital: 3, drugstore: 2 },
  },
];

export const DEFAULT_PRESET = "balance";

export const WEIGHT_LEVELS = [
  { value: 0, label: "考えない" },
  { value: 1, label: "少し" },
  { value: 2, label: "重視" },
  { value: 3, label: "最重視" },
];

export function presetWeights(key) {
  const preset = PRESETS.find((p) => p.key === key) ?? PRESETS[0];
  return Object.fromEntries(SEARCH_CATEGORIES.map((c) => [c.key, preset.weights[c.key] ?? 0]));
}

// 重みがどのプリセットとも一致しないときは null（＝自分で調整した並び）
export function matchPreset(weights) {
  const found = PRESETS.find((p) =>
    SEARCH_CATEGORIES.every((c) => (p.weights[c.key] ?? 0) === (weights[c.key] ?? 0))
  );
  return found ? found.key : null;
}

/**
 * 1段階ぶんの「駅×カテゴリ」の表と、カテゴリごとの分布を作る。
 * matrix は /api/station-matrix.json（scripts/generateApiData.js が出力）。
 */
export function buildTierTable(matrix, walkMinutes) {
  const keys = matrix.categories;
  const rows = matrix.stations
    .filter((s) => Array.isArray(s.counts[walkMinutes]))
    .map((s) => ({
      station: s,
      counts: Object.fromEntries(keys.map((k, i) => [k, s.counts[walkMinutes][i]])),
    }));

  // カテゴリごとに昇順の軒数を持っておき、位置を二分探索で引く
  const sorted = Object.fromEntries(
    keys.map((k) => [k, rows.map((r) => r.counts[k]).sort((a, b) => a - b)])
  );
  return { walkMinutes: Number(walkMinutes), rows, sorted, total: rows.length };
}

function countBelow(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countAtOrBelow(sorted, value) {
  return countBelow(sorted, value + 1);
}

// 0〜100。同じ軒数の駅が大量にある（0軒が多い病院など）ときは、その中央の位置を取る
export function percentileOf(table, key, value) {
  const s = table.sorted[key];
  const below = countBelow(s, value);
  const equal = countAtOrBelow(s, value) - below;
  return ((below + equal / 2) / s.length) * 100;
}

// 「全国の上位◯%」。この軒数以上の駅が全体の何%か（切り上げ、最小1%）
export function topShareOf(table, key, value) {
  const s = table.sorted[key];
  const atLeast = s.length - countBelow(s, value);
  return Math.max(1, Math.ceil((atLeast / s.length) * 100));
}

/**
 * 最低軒数の選択肢。固定の軒数だと段階（徒歩5分〜20分）で意味が変わるため、
 * その段階の実データの分布から「全国の半分／上位25%／上位10%の駅が満たす軒数」を出す。
 */
export function thresholdOptions(table, key) {
  const s = table.sorted[key];
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  const values = [1, at(0.5), at(0.75), at(0.9)].filter((v) => v >= 1);
  return [...new Set(values)]
    .sort((a, b) => a - b)
    .map((value) => ({ value, share: topShareOf(table, key, value) }));
}

/**
 * 条件で絞り、重みで並べる。
 * cond = { pref: "" | 都道府県名, mins: {key: 軒数}, weights: {key: 0〜3} }
 */
export function searchStations(table, cond) {
  const mins = cond.mins ?? {};
  let weights = cond.weights ?? presetWeights(DEFAULT_PRESET);
  // 全部「考えない」にされたら並べようがないので、バランス重視で並べる
  if (!SEARCH_CATEGORIES.some((c) => (weights[c.key] ?? 0) > 0)) {
    weights = presetWeights(DEFAULT_PRESET);
  }
  const weightSum = SEARCH_CATEGORIES.reduce((a, c) => a + (weights[c.key] ?? 0), 0);

  const matches = (row, skipKey) =>
    (!cond.pref || row.station.prefecture === cond.pref || skipKey === "pref") &&
    Object.entries(mins).every(([k, min]) => k === skipKey || !min || row.counts[k] >= min);

  const results = table.rows
    .filter((row) => matches(row))
    .map((row) => {
      const fit =
        SEARCH_CATEGORIES.reduce(
          (a, c) => a + (weights[c.key] ?? 0) * percentileOf(table, c.key, row.counts[c.key]),
          0
        ) / weightSum;
      const scoredTotal = CATEGORIES.reduce((a, c) => a + row.counts[c.key], 0);
      return { ...row, fit: Math.round(fit), fitRaw: fit, scoredTotal };
    })
    .sort(
      (a, b) =>
        b.fitRaw - a.fitRaw ||
        b.scoredTotal - a.scoredTotal ||
        (a.station.kana || "").localeCompare(b.station.kana || "", "ja")
    );

  // 1件も無いとき、どの条件を外せば何駅になるかを出す（行き止まりにしない）
  const activeKeys = [
    ...(cond.pref ? ["pref"] : []),
    ...Object.entries(mins)
      .filter(([, v]) => v)
      .map(([k]) => k),
  ];
  const relax =
    results.length > 0
      ? []
      : activeKeys
          .map((key) => ({ key, count: table.rows.filter((row) => matches(row, key)).length }))
          .filter((r) => r.count > 0)
          .sort((a, b) => b.count - a.count);

  return { results, relax, weights, total: table.total };
}

// 結果の1行に添える根拠。重みの大きいカテゴリから、軒数と全国での位置を出す
export function resultReasons(table, row, weights, limit = 3) {
  return SEARCH_CATEGORIES.filter((c) => (weights[c.key] ?? 0) > 0)
    .sort((a, b) => (weights[b.key] ?? 0) - (weights[a.key] ?? 0))
    .slice(0, limit)
    .map((c) => ({
      key: c.key,
      label: c.label,
      count: row.counts[c.key],
      share: topShareOf(table, c.key, row.counts[c.key]),
    }));
}

// --- URLのクエリと条件の相互変換（条件をURLに残し、共有・再訪できるようにする） ---

export function condFromParams(params, matrix) {
  const walkParam = Number(params.get("walk"));
  const walkMinutes = matrix.walk_minutes.includes(walkParam)
    ? walkParam
    : matrix.default_walk_minutes;
  const pref = params.get("pref") || "";

  const mins = {};
  for (const c of SEARCH_CATEGORIES) {
    const v = Number(params.get(`min_${c.key}`));
    if (Number.isInteger(v) && v > 0) mins[c.key] = v;
  }

  // w=3,3,1,0,1,0,0 （SEARCH_CATEGORIESの順）。無ければプリセット
  let weights;
  const w = params.get("w");
  if (w && /^[0-3](,[0-3]){6}$/.test(w)) {
    const parts = w.split(",").map(Number);
    weights = Object.fromEntries(SEARCH_CATEGORIES.map((c, i) => [c.key, parts[i]]));
  } else {
    weights = presetWeights(params.get("preset") || DEFAULT_PRESET);
  }
  return { walkMinutes, pref, mins, weights };
}

export function paramsFromCond(cond, defaultWalkMinutes) {
  const p = new URLSearchParams();
  const preset = matchPreset(cond.weights);
  if (preset && preset !== DEFAULT_PRESET) p.set("preset", preset);
  if (!preset) p.set("w", SEARCH_CATEGORIES.map((c) => cond.weights[c.key] ?? 0).join(","));
  if (cond.walkMinutes !== defaultWalkMinutes) p.set("walk", String(cond.walkMinutes));
  if (cond.pref) p.set("pref", cond.pref);
  for (const c of SEARCH_CATEGORIES) {
    if (cond.mins[c.key]) p.set(`min_${c.key}`, String(cond.mins[c.key]));
  }
  return p;
}

// 都道府県の並び（北から）。対応駅がある都道府県だけを、この順で出す
const PREFECTURE_ORDER = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県",
  "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** [{ prefecture, stations: [...] }]。各都道府県の中は読みの五十音順 */
export function groupByPrefecture(stations) {
  const map = new Map();
  for (const s of stations) {
    const key = s.prefecture || "その他";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  const rank = (p) => {
    const i = PREFECTURE_ORDER.indexOf(p);
    return i === -1 ? PREFECTURE_ORDER.length : i;
  };
  return [...map]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([prefecture, list]) => ({
      prefecture,
      stations: [...list].sort((a, b) => (a.kana || "").localeCompare(b.kana || "", "ja")),
    }));
}

// 駅名の絞り込み。漢字・ひらがな（読み）・ローマ字のslugのどれでも引けるようにする
export function matchStationName(station, query) {
  const q = query.trim();
  if (!q) return true;
  const hira = q.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return (
    station.name_ja.includes(q) ||
    (station.kana || "").includes(hira) ||
    station.slug.includes(q.toLowerCase())
  );
}
