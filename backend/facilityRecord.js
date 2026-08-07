/**
 * facility-counts.json の1レコードを読み出し側で扱いやすい形に正規化する。
 *
 * 2026-08-07に集計を徒歩5/10/15/20分の4段階へ拡張した際、レコードの形を
 *   旧: { walk_minutes: 10, radius_m: 800, counts: {...} }
 *   新: { walk_speed_m_per_min: 80, tiers: { "5": { radius_m, counts }, ... } }
 * へ変更した。バッチは取得に失敗した駅の既存データを保持する仕様のため、
 * 更新が一巡するまでは新旧が同一ファイル内に混在しうる。読み出し側で分岐が散らばると
 * 事故のもとなので、ここで新形式に寄せてから使う。
 */

const WALK_MINUTES_TIERS = [5, 10, 15, 20];
const DEFAULT_WALK_MINUTES = 10;

function normalizeRecord(record) {
  if (record.tiers) return record;

  // 旧形式: 当時の唯一の集計範囲だった徒歩10分の1段階だけを持つレコードとして扱う
  return {
    ...record,
    tiers: {
      [record.walk_minutes]: {
        radius_m: record.radius_m,
        counts: record.counts,
      },
    },
  };
}

module.exports = { normalizeRecord, WALK_MINUTES_TIERS, DEFAULT_WALK_MINUTES };
