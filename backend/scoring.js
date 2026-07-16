/**
 * 「住みやすさ駅前スコア」算出ロジック
 *
 * カテゴリごとに「これだけあれば生活には十分」という目安の軒数(target)を設定し、
 * 実際の軒数がtargetに対してどれだけ充足しているかを0〜25点で採点、4カテゴリ合計で
 * 0〜100点のスコアにする。targetは統計的根拠のある値ではなく、駅前生活圏の一般的な
 * 感覚に基づく暫定値（要件定義書「スコア機能」参照）。今後、対象駅が増えて実データの
 * 分布が見えてきた段階で見直す前提。
 *
 * 対象駅内での相対評価（最大値=100点）ではなく絶対的なtargetを採用しているのは、
 * 駅を追加するたびに既存駅のスコアが変動してしまう不安定さを避けるため。
 */

const SCORE_TARGETS = {
  convenience_store: 30,
  supermarket: 10,
  hospital: 15,
  restaurant: 400,
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
