// 「条件で駅を探す」「重視する分野で並べる」の計算（2026-09-29追加、同日に6分野版へ作り直し）。
//
// 駅ページは「行きたい駅が決まっている人」しか使えない。引っ越し先を探している人は
// まだ駅名を知らないので、「スーパーが5軒以上ある駅」「子育てに向く駅」のように
// 条件の側から駅を出せるようにする。
//
// 並べ方: 6分野の点（backend/livability.js。施設ごとの全国パーセンタイルの平均、0〜100）を
// 重み付きで平均する。「手頃さ」を重視すると、住宅地の地価が安いほど高い位置（地価の全国
// パーセンタイルを裏返したもの）も混ぜる。
//
// React（pages/SearchPage.jsx・TopPage.jsx）とプリレンダ（scripts/prerender.js）の
// 両方から使うので、拡張子まで明示すること。
import { DOMAINS, ITEMS } from "./livabilityDefs.js";

// 並べ替えに使う軸。6分野＋地価の安さ
export const AXES = [
  ...DOMAINS.map((d) => ({ key: d.key, label: d.label })),
  { key: "affordable", label: "手頃さ（地価の安さ）" },
];

// 目的別の重み。0=考えない、1=少し、2=重視、3=最重視（WEIGHT_LEVELSと対応）
export const PRESETS = [
  {
    key: "balance",
    label: "バランス",
    lead: "6分野すべてを同じ重さで見ます（総合点の順）",
    weights: { shopping: 2, dining: 2, medical: 2, family: 2, services: 2, leisure: 2 },
  },
  {
    key: "single",
    label: "一人暮らし",
    lead: "食事と買い物を重く、生活・安全も見ます",
    weights: { dining: 3, shopping: 3, services: 2, leisure: 1 },
  },
  {
    key: "family",
    label: "子育て",
    lead: "子育て・教育と自然・余暇を重く、医療と買い物も見ます",
    weights: { family: 3, leisure: 3, medical: 2, shopping: 1, services: 1 },
  },
  {
    key: "medical",
    label: "医療・シニア",
    lead: "医療を最も重く、買い物と生活・安全も見ます",
    weights: { medical: 3, shopping: 2, services: 2 },
  },
  {
    key: "value",
    label: "手頃さも",
    lead: "6分野に加えて、住宅地の地価が安いことを重く見ます",
    weights: { shopping: 1, dining: 1, medical: 1, family: 1, services: 1, leisure: 1, affordable: 3 },
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
  return Object.fromEntries(AXES.map((a) => [a.key, preset.weights[a.key] ?? 0]));
}

// 重みがどのプリセットとも一致しないときは null（＝自分で調整した並び）
export function matchPreset(weights) {
  const found = PRESETS.find((p) => AXES.every((a) => (p.weights[a.key] ?? 0) === (weights[a.key] ?? 0)));
  return found ? found.key : null;
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

/**
 * 1段階ぶんの「駅×施設」の表を作る。matrix は /api/station-matrix.json（scripts/stationBundle.js）。
 */
export function buildTierTable(matrix, walkMinutes) {
  const rows = matrix.stations
    .filter((s) => s.t[walkMinutes])
    .map((s) => {
      const t = s.t[walkMinutes];
      return {
        station: s,
        counts: Object.fromEntries(matrix.items.map((k, i) => [k, t.c[i]])),
        domains: Object.fromEntries(matrix.domains.map((k, i) => [k, t.d[i]])),
        total: t.s,
      };
    });

  const sorted = Object.fromEntries(
    matrix.items.map((k) => [k, rows.map((r) => r.counts[k]).sort((a, b) => a - b)])
  );
  const lands = rows.map((r) => r.station.land).filter((v) => v !== null).sort((a, b) => a - b);
  return { walkMinutes: Number(walkMinutes), rows, sorted, lands, total: rows.length };
}

// 「全国の上位◯%」。この軒数以上の駅が全体の何%か（切り上げ、最小1%）
export function topShareOf(table, key, value) {
  const s = table.sorted[key];
  const atLeast = s.length - countBelow(s, value);
  return Math.max(1, Math.ceil((atLeast / s.length) * 100));
}

// 地価が安いほど高い位置（0〜100）。地価が無い駅は null
function affordability(table, land) {
  if (land === null || table.lands.length === 0) return null;
  const below = countBelow(table.lands, land);
  const equal = countBelow(table.lands, land + 1) - below;
  return 100 - ((below + equal / 2) / table.lands.length) * 100;
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

// 地価の上限の選択肢（円/m²）。対応駅の分布の25/50/75%点を1万円単位に丸める
export function landOptions(table) {
  const s = table.lands;
  if (s.length === 0) return [];
  const at = (q) => Math.round(s[Math.floor(s.length * q)] / 10000) * 10000;
  return [...new Set([at(0.25), at(0.5), at(0.75)])].map((value) => ({
    value,
    share: Math.round((countBelow(s, value + 1) / s.length) * 100),
  }));
}

/**
 * 条件で絞り、重みで並べる。
 * cond = { pref, mins: {施設: 軒数}, maxLand: 円/m² | 0, weights: {軸: 0〜3} }
 */
export function searchStations(table, cond) {
  const mins = cond.mins ?? {};
  let weights = cond.weights ?? presetWeights(DEFAULT_PRESET);
  if (!AXES.some((a) => (weights[a.key] ?? 0) > 0)) weights = presetWeights(DEFAULT_PRESET);

  const matches = (row, skipKey) =>
    (!cond.pref || row.station.prefecture === cond.pref || skipKey === "pref") &&
    (!cond.maxLand || skipKey === "maxLand" || (row.station.land !== null && row.station.land <= cond.maxLand)) &&
    Object.entries(mins).every(([k, min]) => k === skipKey || !min || row.counts[k] >= min);

  const results = table.rows
    .filter((row) => matches(row))
    .map((row) => {
      const values = { ...row.domains, affordable: affordability(table, row.station.land) };
      // 地価の無い駅は「手頃さ」を採点から外し、残りの軸で平均する（0点扱いにすると不当に沈む）
      let sum = 0;
      let wsum = 0;
      for (const axis of AXES) {
        const w = weights[axis.key] ?? 0;
        if (!w || values[axis.key] === null) continue;
        sum += w * values[axis.key];
        wsum += w;
      }
      const fitRaw = wsum > 0 ? sum / wsum : 0;
      return { ...row, affordable: values.affordable, fit: Math.round(fitRaw * 10) / 10, fitRaw };
    })
    .sort(
      (a, b) =>
        b.fitRaw - a.fitRaw ||
        b.total - a.total ||
        (a.station.kana || "").localeCompare(b.station.kana || "", "ja")
    );

  // 1件も無いとき、どの条件を外せば何駅になるかを出す（行き止まりにしない）
  const activeKeys = [
    ...(cond.pref ? ["pref"] : []),
    ...(cond.maxLand ? ["maxLand"] : []),
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

// 結果の1行に添える根拠。重みの大きい軸から、点数を出す
export function resultReasons(row, weights, limit = 3) {
  return AXES.filter((a) => (weights[a.key] ?? 0) > 0)
    .filter((a) => a.key !== "affordable" || row.affordable !== null)
    .sort((a, b) => (weights[b.key] ?? 0) - (weights[a.key] ?? 0))
    .slice(0, limit)
    .map((a) => ({
      key: a.key,
      label: a.key === "affordable" ? "手頃さ" : a.label,
      score: a.key === "affordable" ? Math.round(row.affordable * 10) / 10 : row.domains[a.key],
    }));
}

// --- URLのクエリと条件の相互変換（条件をURLに残し、共有・再訪できるようにする） ---

export function condFromParams(params, matrix) {
  const walkParam = Number(params.get("walk"));
  const walkMinutes = matrix.walk_minutes.includes(walkParam) ? walkParam : matrix.default_walk_minutes;
  const pref = params.get("pref") || "";
  const maxLandParam = Number(params.get("max_land"));
  const maxLand = Number.isInteger(maxLandParam) && maxLandParam > 0 ? maxLandParam : 0;

  const mins = {};
  for (const item of ITEMS) {
    const v = Number(params.get(`min_${item.key}`));
    if (Number.isInteger(v) && v > 0) mins[item.key] = v;
  }

  // w=3,3,1,0,1,0,0 （AXESの順）。無ければプリセット
  let weights;
  const w = params.get("w");
  const pattern = new RegExp(`^[0-3](,[0-3]){${AXES.length - 1}}$`);
  if (w && pattern.test(w)) {
    const parts = w.split(",").map(Number);
    weights = Object.fromEntries(AXES.map((a, i) => [a.key, parts[i]]));
  } else {
    weights = presetWeights(params.get("preset") || DEFAULT_PRESET);
  }
  return { walkMinutes, pref, mins, maxLand, weights };
}

export function paramsFromCond(cond, defaultWalkMinutes) {
  const p = new URLSearchParams();
  const preset = matchPreset(cond.weights);
  if (preset && preset !== DEFAULT_PRESET) p.set("preset", preset);
  if (!preset) p.set("w", AXES.map((a) => cond.weights[a.key] ?? 0).join(","));
  if (cond.walkMinutes !== defaultWalkMinutes) p.set("walk", String(cond.walkMinutes));
  if (cond.pref) p.set("pref", cond.pref);
  if (cond.maxLand) p.set("max_land", String(cond.maxLand));
  for (const item of ITEMS) {
    if (cond.mins[item.key]) p.set(`min_${item.key}`, String(cond.mins[item.key]));
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

// 都道府県ページのURL（/pref/<slug>。2026-09-30追加）。PREFECTURE_ORDER と同じ並び
const PREFECTURE_SLUGS = [
  "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima",
  "ibaraki", "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa",
  "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano", "gifu", "shizuoka", "aichi",
  "mie", "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama",
  "tottori", "shimane", "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi",
  "fukuoka", "saga", "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
];

export function prefectureSlug(prefecture) {
  return PREFECTURE_SLUGS[PREFECTURE_ORDER.indexOf(prefecture)] ?? null;
}

// これより駅の少ない都道府県はページを作らず、一覧（/prefectures）に駅を直接並べる。
// 1〜2駅のページは中身がほぼ駅ページの繰り返しになるため（scripts/contentDocs.js）
export const PREF_PAGE_MIN = 3;

/** 駅ページから都道府県へ戻るリンク先。ページの無い都道府県は一覧へ */
export function prefecturePath(prefecture, stations) {
  const count = stations.filter((s) => s.prefecture === prefecture).length;
  const slug = prefectureSlug(prefecture);
  return count >= PREF_PAGE_MIN && slug ? `/pref/${slug}` : "/prefectures";
}

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
