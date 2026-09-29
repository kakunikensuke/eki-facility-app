const { scoreTier } = require("./livability");
const { DEFAULT_WALK_MINUTES } = require("./facilityRecord");

/**
 * 全駅の総合点を上位順で返す（/api/station-scores.json）。
 *
 * 2026-09-29に採点を backend/livability.js（6分野・1000点満点）へ切り替えた。
 * 以前は4カテゴリ・100点満点で、約1割の駅が100点で並んでいたため合計軒数で順位を崩していた。
 * 今の総合点は頭打ちにならないので、同点は駅名順だけで崩す。
 *
 * 段階は既定の徒歩10分に固定する（段階の比較は駅ページで行う）。
 */
function buildStationScores(stations, facilityCounts) {
  const scored = scoreTier(stations, facilityCounts, DEFAULT_WALK_MINUTES);
  return stations
    .filter((s) => scored.has(s.slug))
    .map((s) => {
      const r = scored.get(s.slug);
      return {
        slug: s.slug,
        name_ja: s.name_ja,
        walk_minutes: DEFAULT_WALK_MINUTES,
        score: r.total,
        rank: r.rank,
      };
    })
    .sort((a, b) => b.score - a.score || a.name_ja.localeCompare(b.name_ja, "ja"));
}

module.exports = { buildStationScores };
