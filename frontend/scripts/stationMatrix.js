// 全駅×全段階の軒数表（/api/station-matrix.json の中身）を作る。
//
// generateApiData.js（ブラウザに配るJSON）と prerender.js（静的HTMLの目的別ランキング）の
// 両方がこれを使う。別々に組むと、画面と静的HTMLで順位がズレる。
// 計算そのものは src/stationSearch.js が持ち、ここは表の形を決めるだけ。
import { createRequire } from "module";
import { CATEGORIES, EXTRA_CATEGORIES } from "../src/categories.js";

const require = createRequire(import.meta.url);
const {
  normalizeRecord,
  DEFAULT_WALK_MINUTES,
  WALK_MINUTES_TIERS,
} = require("../../backend/facilityRecord.js");

// 容量を抑えるため、軒数はこの順の配列で持つ
const MATRIX_CATEGORIES = [...CATEGORIES, ...EXTRA_CATEGORIES].map((c) => c.key);

export function buildStationMatrix(stations, facilityCounts) {
  return {
    walk_minutes: WALK_MINUTES_TIERS,
    default_walk_minutes: DEFAULT_WALK_MINUTES,
    categories: MATRIX_CATEGORIES,
    stations: stations
      .filter((s) => facilityCounts[s.slug])
      .map((s) => {
        const counts = {};
        for (const [minutes, tier] of Object.entries(normalizeRecord(facilityCounts[s.slug]).tiers)) {
          counts[minutes] = MATRIX_CATEGORIES.map((key) => tier.counts[key] || 0);
        }
        return { slug: s.slug, name_ja: s.name_ja, kana: s.kana, prefecture: s.prefecture, counts };
      }),
  };
}
