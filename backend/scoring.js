/**
 * 「住みやすさ駅前スコア」算出ロジック
 *
 * カテゴリごとに「これだけあれば生活には十分」という目安の軒数(target)を設定し、
 * 実際の軒数がtargetに対してどれだけ充足しているかを0〜25点で採点、4カテゴリ合計で
 * 0〜100点のスコアにする。
 *
 * targetは2026-07-17、全国349駅中341駅の実データ分布を基に「上位25%の駅で満点になる」
 * 基準（各カテゴリの75パーセンタイル値）に統一して再設定した（要件定義書8.1.1参照）。
 * 初期7駅（大都市のみ）による暫定値から、地方都市・郊外駅を含む分布に基づく値へ更新。
 *
 * 対象駅内での相対評価（最大値=100点）ではなく絶対的なtargetを採用しているのは、
 * 駅を追加するたびに既存駅のスコアが変動してしまう不安定さを避けるため。
 */

const SCORE_TARGETS = {
  convenience_store: 27,
  supermarket: 8,
  hospital: 7,
  restaurant: 140,
};

const POINTS_PER_CATEGORY = 100 / Object.keys(SCORE_TARGETS).length;

function calculateScore(counts) {
  const breakdown = {};
  let total = 0;

  for (const [category, target] of Object.entries(SCORE_TARGETS)) {
    const count = counts[category] || 0;
    const ratio = Math.min(count / target, 1);
    const points = Math.round(ratio * POINTS_PER_CATEGORY * 10) / 10;
    breakdown[category] = points;
    total += points;
  }

  return { total: Math.round(total), breakdown };
}

module.exports = { calculateScore, SCORE_TARGETS };
