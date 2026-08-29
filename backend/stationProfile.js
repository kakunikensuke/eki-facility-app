const { SCORED_CATEGORIES } = require("./scoring");
const { buildStationScores } = require("./stationScores");
const { normalizeRecord } = require("./facilityRecord");

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

/**
 * カテゴリ別の全国順位。slug -> { [category]: { rank, count, total } }。
 *
 * 総合順位（buildRankMap）は4カテゴリを合算した1つの数字なので、「全体では平凡だが
 * 病院だけは全国上位」といった駅の個性が消える。カテゴリごとに並べ直すと、同じ総合順位の
 * 駅でも中身の違いが数字で出る。
 *
 * 同点は同順位にし、次の順位を人数ぶん飛ばす（競技順位）。0軒の駅が大量に並ぶカテゴリでは
 * 下位が軒並み同順位になるが、それが実態なので崩さない。
 *
 * 総合順位と同じく、1駅ずつ引くと全駅の並べ替えをカテゴリ数×駅数ぶん繰り返すことになるため、
 * 表を1度だけ作って使い回す形で公開している。
 */
function buildCategoryRankMap(stations, facilityCounts, walkMinutes, categories = SCORED_CATEGORIES) {
  const countOf = (slug, category) => {
    const record = facilityCounts[slug];
    const tier = record && normalizeRecord(record).tiers[walkMinutes];
    return tier ? tier.counts[category] || 0 : null;
  };

  const result = new Map(stations.map((s) => [s.slug, {}]));

  for (const category of categories) {
    // その段階のデータを持つ駅だけで順位をつける（母数が駅ごとに変わらないよう total も揃える）
    const ranked = stations
      .map((s) => ({ slug: s.slug, count: countOf(s.slug, category) }))
      .filter((s) => s.count !== null)
      .sort((a, b) => b.count - a.count);

    let previousCount = null;
    let previousRank = 0;
    ranked.forEach((s, i) => {
      const rank = s.count === previousCount ? previousRank : i + 1;
      previousCount = s.count;
      previousRank = rank;
      result.get(s.slug)[category] = { rank, count: s.count, total: ranked.length };
    });
  }

  return result;
}

/**
 * 既定段階で0軒だったカテゴリが、どこまで範囲を広げると見つかるか。
 * [{ category, found_at_minutes, count }] を返す（最後まで0軒なら found_at_minutes は null）。
 *
 * 「スーパーが0軒」で終わると、そこが徒歩15分まで歩けば解決する場所なのか、
 * 20分圏まで見ても1軒も無い場所なのかが分からない。4段階を集めているからこそ書ける差で、
 * 住む場所を選ぶ側にとっては軒数そのものより効く情報になる。
 */
function getCategoryReach(tiers, walkMinutes, categories = SCORED_CATEGORIES) {
  const base = tiers[walkMinutes];
  if (!base) return [];

  // 既定段階より広い段階だけを、近い順に見る
  const widerMinutes = Object.keys(tiers)
    .map(Number)
    .filter((m) => m > Number(walkMinutes))
    .sort((a, b) => a - b);

  return categories
    .filter((category) => (base.counts[category] || 0) === 0)
    .map((category) => {
      const found = widerMinutes.find((m) => (tiers[m].counts[category] || 0) > 0);
      return {
        category,
        found_at_minutes: found ?? null,
        count: found ? tiers[found].counts[category] : 0,
      };
    });
}

module.exports = {
  getConcentration,
  getStationRank,
  buildRankMap,
  buildCategoryRankMap,
  getCategoryReach,
  sumScored,
  CONCENTRATION_MIN_SAMPLE,
};
