const { normalizeRecord } = require("./facilityRecord");

/**
 * 「施設の揃い方が似ている駅」を探す（2026-09-29追加）。
 *
 * 駅ページには「近くの駅」があるが、それは距離で選んだもので中身は似ているとは限らない。
 * 引っ越し先を探す人が本当に知りたいのは「今の駅と同じような暮らし方ができる、別の場所の駅」
 * なので、7カテゴリの軒数の組み合わせが近い駅を全国から選ぶ。
 *
 * 近さの測り方:
 * - 軒数は駅によって桁が違う（飲食店は0〜1,000軒超、病院は0〜数十軒）ので、
 *   そのまま差を取ると飲食店だけで順位が決まってしまう。log(1+軒数) にしてから
 *   カテゴリごとに標準化（平均0・標準偏差1）し、7カテゴリを同じ重さで扱う。
 * - 近い駅は集計範囲の円が重なり、同じ店を数えているので似て当然になる。
 *   それは「近くの駅」欄で既に出しているので、ここでは一定距離より近い駅を除く。
 *
 * frontend/scripts/generateApiData.js・prerender.js から使う
 * （APIと静的HTMLで結果がズレないよう、算出は1箇所に置く）。
 */

// 7カテゴリ（スコア対象の4つ＋表示のみの3つ）。暮らし方の近さを見るので公園・保育園も含める
const SIMILARITY_CATEGORIES = [
  "convenience_store",
  "supermarket",
  "hospital",
  "restaurant",
  "drugstore",
  "park",
  "nursery",
];

// 徒歩10分圏（半径800m）どうしが重ならない距離。これより近い駅は同じ店を数えている
const MIN_DISTANCE_KM = 1.6;

// 標準化した値の差がこれ以下なら「軒数が近い」と言ってよい幅（約0.4標準偏差）
const CLOSE_Z = 0.4;
// これ以上なら「違いが大きい」として触れる
const FAR_Z = 1.0;

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * slug -> [{ slug, name_ja, prefecture, close: [{category, own, other}], far: {category, own, other} | null }]
 * （own は基準の駅、other は似ている駅の軒数）
 * の対応表を作る。349駅×349駅の総当たりなので、駅ごとに呼ばず1度だけ作って使い回す。
 */
function buildSimilarMap(stations, facilityCounts, walkMinutes, limit = 5) {
  const rows = stations
    .map((station) => {
      const raw = facilityCounts[station.slug];
      const tier = raw && normalizeRecord(raw).tiers[walkMinutes];
      if (!tier) return null;
      const counts = SIMILARITY_CATEGORIES.map((key) => tier.counts[key] || 0);
      return { station, counts, logs: counts.map((c) => Math.log1p(c)) };
    })
    .filter(Boolean);

  // カテゴリごとの平均と標準偏差（標準偏差0のカテゴリは差が出ないので1で割る）
  const stats = SIMILARITY_CATEGORIES.map((_, i) => {
    const values = rows.map((r) => r.logs[i]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    return { mean, sd };
  });
  for (const r of rows) r.z = r.logs.map((v, i) => (v - stats[i].mean) / stats[i].sd);

  const result = new Map();
  for (const self of rows) {
    const candidates = rows
      .filter((other) => other !== self && distanceKm(self.station, other.station) >= MIN_DISTANCE_KM)
      .map((other) => {
        const diffs = self.z.map((v, i) => Math.abs(v - other.z[i]));
        return { other, diffs, dist: Math.sqrt(diffs.reduce((a, d) => a + d * d, 0)) };
      })
      .sort((a, b) => a.dist - b.dist || a.other.station.slug.localeCompare(b.other.station.slug));

    // 同じ場所にある別事業者の駅（「新大阪駅」と「Osaka Metro 新大阪駅」など）は中身がほぼ同じで、
    // 両方出すと枠を食うだけなので、選んだ駅の近くにある候補は飛ばす
    const picked = [];
    for (const c of candidates) {
      if (picked.length >= limit) break;
      if (picked.some((p) => distanceKm(p.other.station, c.other.station) < MIN_DISTANCE_KM)) continue;
      picked.push(c);
    }

    result.set(
      self.station.slug,
      picked.map(({ other, diffs }) => {
        const order = diffs.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
        // 近いカテゴリは差の小さい順に最大3つ。どれも近くなければ空（文章側でその旨を書かない）
        const close = order
          .filter((o) => o.d <= CLOSE_Z)
          .slice(0, 3)
          .map((o) => ({
            category: SIMILARITY_CATEGORIES[o.i],
            own: self.counts[o.i],
            other: other.counts[o.i],
          }));
        const farthest = order[order.length - 1];
        const far =
          farthest.d >= FAR_Z
            ? {
                category: SIMILARITY_CATEGORIES[farthest.i],
                own: self.counts[farthest.i],
                other: other.counts[farthest.i],
              }
            : null;
        return {
          slug: other.station.slug,
          name_ja: other.station.name_ja,
          prefecture: other.station.prefecture ?? null,
          close,
          far,
        };
      })
    );
  }
  return result;
}

module.exports = { buildSimilarMap, SIMILARITY_CATEGORIES, MIN_DISTANCE_KM };
