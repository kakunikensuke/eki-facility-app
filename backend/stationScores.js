const { calculateScore, SCORED_CATEGORIES } = require("./scoring");
const { normalizeRecord, DEFAULT_WALK_MINUTES } = require("./facilityRecord");

/**
 * トップページのランキング用に、全駅のスコアを上位順で返す。
 *
 * 段階は既定の徒歩10分に固定する。トップで段階を切り替えられるようにすると
 * 順位が4通りできてしまい、「上位の駅」という一覧の意味が薄れるため
 * （段階の比較は駅ページのタブで行う）。
 *
 * 並び順は「スコア降順 → 合計軒数降順 → 駅名順」。
 * スコアは各カテゴリがtarget値で頭打ちになる設計上100点が上限で、
 * 徒歩10分では約1割の駅が満点に達する。スコアだけで並べると満点の駅の順序が
 * 駅名順（＝実力と無関係）になり、上位が特定の事業者名で埋まって
 * さも上位を独占しているように見えてしまう。合計軒数で崩して実態に沿わせ、
 * 画面にも軒数を併記して並び順の根拠が見えるようにしている。
 *
 * server.js と frontend/scripts/prerender.js の双方から使う（順位がAPIと
 * 静的HTMLでズレないよう、算出は1箇所に置く）。
 */
function buildStationScores(stations, facilityCounts) {
  return stations
    .map((station) => {
      const raw = facilityCounts[station.slug];
      if (!raw) return null;
      const tier = normalizeRecord(raw).tiers[DEFAULT_WALK_MINUTES];
      // 集計途中で既定の段階をまだ持たない駅は順位をつけられないので除外する
      if (!tier) return null;
      return {
        slug: station.slug,
        name_ja: station.name_ja,
        walk_minutes: DEFAULT_WALK_MINUTES,
        score: calculateScore(tier.counts, DEFAULT_WALK_MINUTES).total,
        // 駅ページの「合計軒数」と同じ定義（スコア対象の4カテゴリのみ）
        total_count: SCORED_CATEGORIES.reduce((sum, key) => sum + (tier.counts[key] || 0), 0),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.total_count - a.total_count ||
        a.name_ja.localeCompare(b.name_ja, "ja")
    );
}

module.exports = { buildStationScores };
