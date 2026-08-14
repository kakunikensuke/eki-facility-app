const { SCORED_CATEGORIES } = require("./scoring");
const { buildStationScores } = require("./stationScores");

/**
 * 駅ページに出す「その駅にしか当てはまらない情報」を作る。
 *
 * 駅ページは数字の表とテンプレ文だけで本文522文字しかなく、349枚が同じ形をしていた
 * （2026-08-08にAdSenseから「有用性の低いコンテンツ」で不承認）。文章を水増しすると
 * かえって量産ページらしくなるため、実データからしか出てこない事実を足す方針にした。
 */

// 徒歩5分圏への集中度を出すのに必要な、徒歩20分圏の最低軒数。
// これ未満だと比率が極端に振れる（例: 山寺駅は14/16で87.5%になるが、
// 母数16軒では「駅前に集中している」と言っても意味がない）。
const CONCENTRATION_MIN_SAMPLE = 50;

// 判定のしきい値。2026-08-08時点、条件を満たす308駅の実データの四分位。
// 中央値20.2%、上位25%が32.8%以上、下位25%が11.1%以下だった。
// 参考: 円の面積比は (400/1600)^2 = 6.25% なので、施設が均一に散っていれば6.25%になる。
const CONCENTRATION_HIGH = 33;
const CONCENTRATION_LOW = 11;

function sumScored(counts) {
  return SCORED_CATEGORIES.reduce((sum, key) => sum + (counts[key] || 0), 0);
}

/**
 * 徒歩20分圏の施設のうち何%が徒歩5分圏に収まっているか。
 * 「駅前に店が固まっているのか、離れた場所に散っているのか」は軒数の多寡とは
 * 別の軸で、同じスコアの駅でも住んだときの体感が変わる部分。
 * 判定できないときはnullを返す（4段階が揃っていない駅・母数が小さい駅）。
 */
function getConcentration(tiers) {
  const near = tiers["5"];
  const far = tiers["20"];
  if (!near || !far) return null;

  const farTotal = sumScored(far.counts);
  if (farTotal < CONCENTRATION_MIN_SAMPLE) return null;

  const nearTotal = sumScored(near.counts);
  const percent = Math.round((nearTotal / farTotal) * 100);
  const type =
    percent >= CONCENTRATION_HIGH ? "concentrated" : percent <= CONCENTRATION_LOW ? "spread" : "average";

  return { percent, type, near_total: nearTotal, far_total: farTotal };
}

/**
 * slug -> { rank, total } の対応表（既定段階のスコア順、同点は合計軒数で崩す）。
 * 並び順の定義は buildStationScores と共有するので、トップのランキングと必ず一致する。
 *
 * プリレンダは349駅ぶんの順位が要るので、1駅ずつ探すと全駅の再計算を349回繰り返す。
 * 表を1度だけ作って使い回せるよう、この形で公開している。
 */
function buildRankMap(stations, facilityCounts) {
  const ranked = buildStationScores(stations, facilityCounts);
  return new Map(ranked.map((s, i) => [s.slug, { rank: i + 1, total: ranked.length }]));
}

/** 1駅ぶんの順位。APIのように単発で引くとき用。 */
function getStationRank(slug, stations, facilityCounts) {
  return buildRankMap(stations, facilityCounts).get(slug) ?? null;
}

module.exports = { getConcentration, getStationRank, buildRankMap, CONCENTRATION_MIN_SAMPLE };
