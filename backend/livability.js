const { normalizeRecord, WALK_MINUTES_TIERS } = require("./facilityRecord");

/**
 * 住みやすさ駅前スコア（2026-09-29版）。
 *
 * 旧スコア（scoring.js）はコンビニ・スーパー・病院・飲食店の4カテゴリだけを見て、
 * 各カテゴリが全国の上位25%の軒数（target）に届いたら満点、という作りだった。
 * そのため徒歩10分では約1割の駅が100点で並び、上位の駅に差がつかなかった。
 *
 * 今の作り:
 * - 18種類の施設を6つの分野にまとめる（DOMAINS）
 * - 施設ごとに「全国の対応駅の中での位置」（パーセンタイル、0〜100）を出す。
 *   軒数の桁が違う施設（飲食店は数百、図書館は0〜2）も同じ物差しで並べられる
 * - 分野の点 = その分野の施設のパーセンタイルの平均（0〜100、小数1桁）
 * - 総合点 = 6分野の平均 × 10（0〜1000点）。満点で頭打ちにならないので、上位の駅にも差がつく
 *
 * 相対評価なので、対象駅を増やすと既存の駅の点数も少し動く。旧スコアはそれを避けるために
 * 絶対的なtargetを使っていたが、頭打ちで順位が機能しなくなる方が問題が大きいと判断した。
 *
 * 地価と乗降客数は点数に混ぜない（「店が多い」と「安い」は別の話で、足すと何の点か分からなくなる）。
 * 画面では並べて見せる（station-public.json）。
 *
 * generateApiData.js・prerender.js・server.js から使う。算出はここ1か所に置くこと。
 */

// 施設（facility-counts.json のキー）。restaurant はカフェを含む集計なので、
// 表示と採点には カフェを除いた数（restaurant_only）を使う
const ITEMS = [
  { key: "convenience_store", label: "コンビニ", domain: "shopping" },
  { key: "supermarket", label: "スーパー", domain: "shopping" },
  { key: "drugstore", label: "ドラッグストア", domain: "shopping" },
  { key: "variety_store", label: "100円ショップ", domain: "shopping" },

  { key: "restaurant_only", label: "飲食店", note: "ファストフードを含む・カフェを除く", domain: "dining" },
  { key: "cafe", label: "カフェ", domain: "dining" },

  { key: "hospital", label: "病院・クリニック", domain: "medical" },
  { key: "dentist", label: "歯科", domain: "medical" },
  { key: "pharmacy", label: "調剤薬局", domain: "medical" },

  { key: "nursery", label: "保育園・幼稚園", domain: "family" },
  { key: "school", label: "学校", note: "小・中・高を区別しない", domain: "family" },
  { key: "library", label: "図書館", domain: "family" },

  { key: "post_office", label: "郵便局", domain: "services" },
  { key: "bank", label: "銀行・ATM", domain: "services" },
  { key: "laundry", label: "コインランドリー", domain: "services" },
  { key: "police", label: "交番・警察署", domain: "services" },

  { key: "park", label: "公園", domain: "leisure" },
  { key: "fitness", label: "ジム", domain: "leisure" },
  { key: "public_bath", label: "銭湯", domain: "leisure" },
];

const DOMAINS = [
  { key: "shopping", label: "買い物", lead: "日用品と食料品の買いやすさ" },
  { key: "dining", label: "食事", lead: "外食とカフェの選択肢" },
  { key: "medical", label: "医療", lead: "通院と薬の受け取りやすさ" },
  { key: "family", label: "子育て・教育", lead: "保育・学校・図書館" },
  { key: "services", label: "生活・安全", lead: "郵便・お金・洗濯と交番" },
  { key: "leisure", label: "自然・余暇", lead: "公園と運動・お風呂" },
];

for (const domain of DOMAINS) domain.items = ITEMS.filter((i) => i.domain === domain.key).map((i) => i.key);

// 施設ごとの軒数。restaurant_only は集計結果から作る（カフェの集計が無い古いレコードではそのまま）
function itemCounts(counts) {
  const out = {};
  for (const item of ITEMS) {
    if (item.key === "restaurant_only") {
      out.restaurant_only = Math.max(0, (counts.restaurant || 0) - (counts.cafe || 0));
    } else {
      out[item.key] = counts[item.key] || 0;
    }
  }
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;

// 同じ軒数の駅が多い（0軒が大量にある等）ときは、その中央の位置を取る
function percentile(sortedAsc, value) {
  let below = 0;
  let equal = 0;
  for (const v of sortedAsc) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / sortedAsc.length) * 100;
}

// 競技順位（同点は同順位、次は人数ぶん飛ばす）。values は slug -> 数値
function rankMap(values) {
  const sorted = [...values.entries()].sort((a, b) => b[1] - a[1]);
  const ranks = new Map();
  let prev = null;
  let prevRank = 0;
  sorted.forEach(([slug, v], i) => {
    const rank = v === prev ? prevRank : i + 1;
    ranks.set(slug, rank);
    prev = v;
    prevRank = rank;
  });
  return ranks;
}

/**
 * 1段階（徒歩◯分）ぶんの全駅の採点。
 * slug -> { counts, items: {key: {count, pct}}, domains: {key: {score, rank}}, total, rank, of }
 */
function scoreTier(stations, facilityCounts, walkMinutes) {
  const rows = stations
    .map((station) => {
      const raw = facilityCounts[station.slug];
      const tier = raw && normalizeRecord(raw).tiers[walkMinutes];
      return tier ? { slug: station.slug, counts: itemCounts(tier.counts), raw: tier.counts } : null;
    })
    .filter(Boolean);

  const sortedByItem = Object.fromEntries(
    ITEMS.map((item) => [item.key, rows.map((r) => r.counts[item.key]).sort((a, b) => a - b)])
  );

  const results = new Map();
  for (const row of rows) {
    const items = {};
    for (const item of ITEMS) {
      items[item.key] = { count: row.counts[item.key], pct: percentile(sortedByItem[item.key], row.counts[item.key]) };
    }
    const domains = {};
    for (const domain of DOMAINS) {
      const avg = domain.items.reduce((a, k) => a + items[k].pct, 0) / domain.items.length;
      domains[domain.key] = { score: round1(avg) };
    }
    const total = Math.round((DOMAINS.reduce((a, d) => a + domains[d.key].score, 0) / DOMAINS.length) * 10);
    results.set(row.slug, { counts: row.counts, raw_counts: row.raw, items, domains, total });
  }

  // 順位（総合・分野別）
  const totalRanks = rankMap(new Map([...results].map(([slug, r]) => [slug, r.total])));
  const domainRanks = Object.fromEntries(
    DOMAINS.map((d) => [d.key, rankMap(new Map([...results].map(([slug, r]) => [slug, r.domains[d.key].score])))])
  );
  for (const [slug, r] of results) {
    r.rank = totalRanks.get(slug);
    r.of = results.size;
    for (const d of DOMAINS) r.domains[d.key].rank = domainRanks[d.key].get(slug);
    for (const item of ITEMS) r.items[item.key].pct = round1(r.items[item.key].pct);
  }
  return results;
}

/** 全段階ぶん。{ [walkMinutes]: Map(slug -> 採点結果) } */
function scoreAllTiers(stations, facilityCounts) {
  return Object.fromEntries(WALK_MINUTES_TIERS.map((m) => [m, scoreTier(stations, facilityCounts, m)]));
}

/**
 * 地価・乗降客数の全国での位置。slug -> { land: {..., rank_high, of}, ridership: {..., rank, of} }
 * 地価は「高い順」の順位（1位が最も高い）。
 */
function publicRanks(stationPublic) {
  const entries = Object.entries(stationPublic);
  const land = rankMap(
    new Map(entries.filter(([, v]) => v.land).map(([slug, v]) => [slug, v.land.median_yen_per_m2]))
  );
  const ridership = rankMap(
    new Map(entries.filter(([, v]) => v.ridership).map(([slug, v]) => [slug, v.ridership.daily]))
  );
  const out = {};
  for (const [slug, v] of entries) {
    out[slug] = {
      land: v.land ? { ...v.land, rank_high: land.get(slug), of: land.size } : null,
      ridership: v.ridership ? { ...v.ridership, rank: ridership.get(slug), of: ridership.size } : null,
    };
  }
  return out;
}

module.exports = { ITEMS, DOMAINS, itemCounts, scoreTier, scoreAllTiers, publicRanks };
