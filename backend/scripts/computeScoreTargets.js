/**
 * スコアのtarget値（scoring.jsのSCORE_TARGETS_BY_WALK_MINUTES）と、
 * 「こんな人におすすめ」タグのしきい値（stationTags.jsのTAG_THRESHOLDS_BY_WALK_MINUTES）を
 * facility-counts.jsonの実データから再計算して表示する。
 *
 *   node scripts/computeScoreTargets.js
 *
 * いずれも「上位25%の駅がこの値以上になる水準」＝各カテゴリの75パーセンタイル値と定義している
 * （要件定義書8.1.1）。段階ごとに集計面積が変わるため、徒歩5/10/15/20分それぞれで別の値になる。
 *
 * 出力を各ファイルに貼り付けて使う。自動読み込みにしていないのは、対象駅が増減するたびに
 * 既存駅のスコアが動いてしまうのを避けるため（scoring.jsの冒頭コメント参照）。値の更新は
 * 「意図して行う操作」に留めたい。
 */

const fs = require("fs");
const path = require("path");
const { normalizeRecord, WALK_MINUTES_TIERS } = require("../facilityRecord");

const FACILITY_COUNTS_PATH = path.join(__dirname, "..", "data", "facility-counts.json");
// スコア対象の4カテゴリ。タグ判定はこれに公園・保育園幼稚園・ドラッグストアを加えた7カテゴリを使う
const SCORED_CATEGORIES = ["convenience_store", "supermarket", "hospital", "restaurant"];
const TAG_CATEGORIES = [...SCORED_CATEGORIES, "park", "nursery", "drugstore"];

// 昇順に並べたときの75パーセンタイル値。上位25%の駅がこの値以上になる。
function percentile75(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)];
}

const facilityCounts = JSON.parse(fs.readFileSync(FACILITY_COUNTS_PATH, "utf-8"));
const records = Object.values(facilityCounts).map(normalizeRecord);

const scoreTargets = {};
const tagThresholds = {};
for (const walkMinutes of WALK_MINUTES_TIERS) {
  const tiers = records.map((r) => r.tiers[walkMinutes]).filter(Boolean);
  if (tiers.length === 0) {
    console.error(`徒歩${walkMinutes}分: 実データを持つ駅が0件のためスキップします`);
    continue;
  }

  const percentiles = {};
  for (const category of TAG_CATEGORIES) {
    percentiles[category] = percentile75(tiers.map((t) => t.counts[category] || 0));
  }

  scoreTargets[walkMinutes] = Object.fromEntries(
    SCORED_CATEGORIES.map((c) => [c, percentiles[c]])
  );
  tagThresholds[walkMinutes] = percentiles;
  console.error(`徒歩${walkMinutes}分: ${tiers.length}駅の実データから算出`);
}

console.log("\n// scoring.js の SCORE_TARGETS_BY_WALK_MINUTES に貼り付ける:");
console.log(JSON.stringify(scoreTargets, null, 2));
console.log("\n// stationTags.js の TAG_THRESHOLDS_BY_WALK_MINUTES に貼り付ける:");
console.log(JSON.stringify(tagThresholds, null, 2));
