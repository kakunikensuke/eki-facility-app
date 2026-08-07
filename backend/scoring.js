/**
 * 「住みやすさ駅前スコア」算出ロジック
 *
 * カテゴリごとに「これだけあれば生活には十分」という目安の軒数(target)を設定し、
 * 実際の軒数がtargetに対してどれだけ充足しているかを0〜25点で採点、4カテゴリ合計で
 * 0〜100点のスコアにする。
 *
 * targetは「上位25%の駅で満点になる」基準（各カテゴリの75パーセンタイル値）を全国349駅の
 * 実データから求めたもの（要件定義書8.1.1参照）。2026-08-07に集計範囲を徒歩5/10/15/20分の
 * 4段階へ拡張したのに伴い、段階ごとに別のtargetを持たせている。集計面積が段階で16倍まで
 * 変わる以上、単一のtargetでは徒歩5分がほぼ0点・徒歩20分がほぼ満点になってしまうため。
 *
 * 値の再計算は scripts/computeScoreTargets.js で行い、出力をここに貼り付ける。
 * 自動読み込みにしていないのは、対象駅が増減するたびに既存駅のスコアが動くのを避けるため。
 *
 * 対象駅内での相対評価（最大値=100点）ではなく絶対的なtargetを採用しているのも同じ理由。
 */

// 2026-08-07、全349駅の4段階実データから算出した75パーセンタイル値。
const SCORE_TARGETS_BY_WALK_MINUTES = {
  5: {
    convenience_store: 13,
    supermarket: 4,
    hospital: 3,
    restaurant: 77,
  },
  10: {
    convenience_store: 27,
    supermarket: 9,
    hospital: 7,
    restaurant: 143,
  },
  15: {
    convenience_store: 47,
    supermarket: 15,
    hospital: 13,
    restaurant: 227,
  },
  20: {
    convenience_store: 86,
    supermarket: 26,
    hospital: 21,
    restaurant: 386,
  },
};

const SCORED_CATEGORIES = ["convenience_store", "supermarket", "hospital", "restaurant"];
const POINTS_PER_CATEGORY = 100 / SCORED_CATEGORIES.length;

function calculateScore(counts, walkMinutes) {
  const targets = SCORE_TARGETS_BY_WALK_MINUTES[walkMinutes];
  if (!targets) {
    throw new Error(`徒歩${walkMinutes}分のtarget値が未定義です（scoring.js）`);
  }

  const breakdown = {};
  let total = 0;

  for (const category of SCORED_CATEGORIES) {
    const count = counts[category] || 0;
    const ratio = Math.min(count / targets[category], 1);
    const points = Math.round(ratio * POINTS_PER_CATEGORY * 10) / 10;
    breakdown[category] = points;
    total += points;
  }

  return { total: Math.round(total), breakdown };
}

module.exports = { calculateScore, SCORE_TARGETS_BY_WALK_MINUTES, SCORED_CATEGORIES };
