// 駅ごとの表示データ一式（採点・順位・公的データ・写真・似ている駅など）をまとめて作る（2026-09-29追加）。
//
// generateApiData.js（ブラウザに配るJSON）と prerender.js（静的HTML）の両方がこれを使う。
// 以前は両方のスクリプトがそれぞれ採点や順位を組み立てていて、片方だけ直すと
// 画面とクローラの見る中身がずれる作りだった。今はここで1回だけ作り、両方が同じ物を読む。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { distanceKm, findNearbyStations, formatDistance } from "../src/nearbyStations.js";
import { DOMAINS, ITEMS } from "../src/livabilityDefs.js";
import { RENT_MARKET_FACTOR, RENT_ROOM_M2 } from "../src/stationProfileText.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  normalizeRecord,
  DEFAULT_WALK_MINUTES,
  WALK_MINUTES_TIERS,
} = require("../../backend/facilityRecord.js");
const livability = require("../../backend/livability.js");
const { getConcentration, getCategoryReach } = require("../../backend/stationProfile.js");
const { buildSimilarMap } = require("../../backend/stationSimilarity.js");
const { buildStationScores } = require("../../backend/stationScores.js");

const DATA_DIR = path.join(__dirname, "..", "..", "backend", "data");

function readJson(name, fallback) {
  const p = path.join(DATA_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : fallback;
}

export function loadData() {
  return {
    stations: readJson("stations.json"),
    facilityCounts: readJson("facility-counts.json"),
    // 公的データと写真は年1回・不定期に手元で更新するファイル（backend/scripts/ 参照）。
    // 無くてもビルドは通し、その欄を出さないだけにする
    stationPublic: readJson("station-public.json", { source: null, stations: {} }),
    stationPhotos: readJson("station-photos.json", {}),
    // 災害リスク（fetchHazard.js）と路線（importLines.js）。どちらも手元で不定期に更新する
    stationHazard: readJson("station-hazard.json", { stations: {} }),
    stationLines: readJson("station-lines.json", { lines: [], station_lines: {} }),
    // 駅から近い施設の名前（backend/scripts/buildNearbyFacilities.js。2026-09-30追加）
    stationNearby: readJson("station-nearby.json", { stations: {} }),
    // 市区町村の家賃水準（backend/scripts/importRent.js。住宅・土地統計調査。2026-09-30追加）
    stationRent: readJson("station-rent.json", { stations: {} }),
    // 家賃の目安を募集家賃の水準に直す都道府県ごとの倍率（backend/scripts/calibrateRent.js）
    rentFactors: readJson("rent-factors.json", { factors: {} }),
    // 市区町村の人口の構成と待機児童（backend/scripts/importCensus.js。国勢調査・こども家庭庁。2026-09-30追加）
    stationPeople: readJson("station-people.json", { stations: {} }),
  };
}

// 画面側の定義（src/livabilityDefs.js）が採点側（backend/livability.js）とずれていたらビルドを止める。
// ずれたまま出すと、ある分野の点に別の施設の名前が付く、といった誤表示になる
export function assertDefsInSync() {
  const pick = (list, fields) => JSON.stringify(list.map((x) => fields.map((f) => x[f])));
  const errors = [];
  if (pick(DOMAINS, ["key", "label"]) !== pick(livability.DOMAINS, ["key", "label"])) {
    errors.push("DOMAINS が backend/livability.js と一致しない");
  }
  if (pick(ITEMS, ["key", "label", "domain"]) !== pick(livability.ITEMS, ["key", "label", "domain"])) {
    errors.push("ITEMS が backend/livability.js と一致しない");
  }
  if (errors.length > 0) throw new Error(`src/livabilityDefs.js: ${errors.join(" / ")}`);
}

// 「徒歩10分圏内に0軒だったら、どこまで広げると見つかるか」を見る主要4施設
const REACH_KEYS = ["convenience_store", "supermarket", "hospital", "restaurant"];
// 「最も近い駅との比較」を出す距離の上限。地方では最も近い掲載駅が40km先の別の県になることがあり、
// 住む場所を選ぶときの比べ方として不自然なので、その場合は県内・路線内の順位だけにする（2026-09-30）
const NEAREST_MAX_KM = 5;

export function buildAll({
  stations,
  facilityCounts,
  stationPublic,
  stationPhotos,
  stationHazard,
  stationLines,
  stationNearby,
  stationRent,
  rentFactors,
  stationPeople,
}) {
  assertDefsInSync();

  const scoredByTier = livability.scoreAllTiers(stations, facilityCounts);
  const publicBySlug = livability.publicRanks(stationPublic.stations || {});
  const similarBySlug = buildSimilarMap(stations, facilityCounts, DEFAULT_WALK_MINUTES);
  const defaultScores = scoredByTier[DEFAULT_WALK_MINUTES];
  const rentBySlug = buildRentMap(stationRent, rentFactors, stations);
  const peopleBySlug = buildPeopleMap(stationPeople, stations);

  const bundles = new Map();
  for (const station of stations) {
    const raw = facilityCounts[station.slug];
    if (!raw) continue;
    const record = normalizeRecord(raw);

    const tiers = {};
    for (const minutes of WALK_MINUTES_TIERS) {
      const r = scoredByTier[minutes].get(station.slug);
      if (!r) continue;
      tiers[minutes] = {
        walk_minutes: minutes,
        radius_m: record.tiers[minutes].radius_m,
        total: r.total,
        rank: r.rank,
        of: r.of,
        domains: r.domains,
        items: r.items,
      };
    }
    const walkMinutes = Object.keys(tiers).map(Number).sort((a, b) => a - b);
    if (walkMinutes.length === 0) continue;

    // 最も近い駅との総合点の比較（同じ既定段階どうし）
    const nearestStation = findNearbyStations(station, stations, 1)[0];
    const nearestScore =
      nearestStation && nearestStation.km <= NEAREST_MAX_KM && defaultScores.get(nearestStation.station.slug);
    const ownScore = defaultScores.get(station.slug);
    const nearest =
      nearestScore && ownScore
        ? {
            name: nearestStation.station.name_ja,
            slug: nearestStation.station.slug,
            distance: formatDistance(nearestStation.km),
            total: nearestScore.total,
            own_total: ownScore.total,
          }
        : null;

    bundles.set(station.slug, {
      slug: station.slug,
      name_ja: station.name_ja,
      kana: station.kana,
      prefecture: station.prefecture,
      lat: station.lat,
      lon: station.lon,
      default_walk_minutes: tiers[DEFAULT_WALK_MINUTES] ? DEFAULT_WALK_MINUTES : walkMinutes[0],
      walk_minutes: walkMinutes,
      tiers,
      public: publicBySlug[station.slug] ?? { land: null, ridership: null },
      rent: rentBySlug.get(station.slug) ?? null,
      people: peopleBySlug.get(station.slug) ?? null,
      photos: stationPhotos[station.slug]?.photos ?? [],
      // 写真を載せているWikipedia記事の題名（出典の表示に使う）
      photo_article: stationPhotos[station.slug]?.article ?? null,
      // 写真の出どころ（駅の記事・駅の近くの写真・市区町村の記事。fetchStationPhotos.js の --fill）
      photo_source: stationPhotos[station.slug]?.source ?? "article",
      concentration: getConcentration(record.tiers),
      category_reach: getCategoryReach(record.tiers, DEFAULT_WALK_MINUTES, REACH_KEYS),
      nearest,
      hazard: stationHazard?.stations?.[station.slug] ?? null,
      lines: (stationLines?.station_lines?.[station.slug] ?? []).map((lineSlug) => ({
        slug: lineSlug,
        name: stationLines.lines.find((l) => l.slug === lineSlug).name,
      })),
      similar_stations: similarBySlug.get(station.slug) ?? [],
      nearby_facilities: stationNearby?.stations?.[station.slug] ?? null,
      updated_at: record.updated_at,
      source: record.source,
    });
  }

  addLocalRanks(bundles, stationLines);
  addLineHubs(bundles, stationLines);

  // 条件検索・トップの目的別ランキング用の全駅表（/api/station-matrix.json）。
  // 容量を抑えるため、施設の軒数（c）と分野の点（d）は ITEMS / DOMAINS の順の配列で持つ
  const matrix = {
    walk_minutes: WALK_MINUTES_TIERS,
    default_walk_minutes: DEFAULT_WALK_MINUTES,
    items: ITEMS.map((i) => i.key),
    domains: DOMAINS.map((d) => d.key),
    stations: [...bundles.values()].map((b) => ({
      slug: b.slug,
      name_ja: b.name_ja,
      kana: b.kana,
      prefecture: b.prefecture,
      land: b.public.land?.median_yen_per_m2 ?? null,
      ridership: b.public.ridership?.daily ?? null,
      t: Object.fromEntries(
        Object.entries(b.tiers).map(([m, t]) => [
          m,
          {
            c: ITEMS.map((i) => t.items[i.key].count),
            d: DOMAINS.map((d) => t.domains[d.key].score),
            s: t.total,
          },
        ])
      ),
    })),
  };

  // トップページの背景用。全駅ぶんの写真の最初の2枚と、表示に必須の帰属表示だけ。
  // 2026-09-30、1,856駅に増やしたら4枚では圧縮後でも265KBになったので2枚に減らした（駅ページは別のJSONで6枚まで出す）
  const photosLite = {};
  for (const b of bundles.values()) {
    if (b.photos.length === 0) continue;
    photosLite[b.slug] = b.photos.slice(0, 2).map((p) => ({
      src: p.src,
      caption: p.caption,
      artist: p.artist,
      license: p.license,
      page: p.page,
    }));
  }

  return {
    bundles,
    matrix,
    photosLite,
    scores: buildStationScores(stations, facilityCounts),
    publicSource: stationPublic.source,
  };
}

// 県内・路線内での総合点の順位（既定の徒歩段階）。2026-09-30追加。
// 全国順位だけだと「同じ県・同じ路線で比べてどうか」という実際の選び方に答えられないため
function addLocalRanks(bundles, stationLines) {
  const totalOf = (b) => b.tiers[b.default_walk_minutes].total;
  const brief = (b) => ({ slug: b.slug, name: b.name_ja, total: totalOf(b) });
  const rankIn = (list, b) => {
    const sorted = [...list].sort((x, y) => totalOf(y) - totalOf(x));
    const i = sorted.indexOf(b);
    return {
      rank: i + 1,
      of: sorted.length,
      own: totalOf(b),
      first: i > 0 ? brief(sorted[0]) : null,
      second: i === 0 && sorted.length > 1 ? brief(sorted[1]) : null,
      above: i > 1 ? brief(sorted[i - 1]) : null,
      below: i > 0 && i < sorted.length - 1 ? brief(sorted[i + 1]) : null,
    };
  };
  const byPref = new Map();
  for (const b of bundles.values()) {
    if (!byPref.has(b.prefecture)) byPref.set(b.prefecture, []);
    byPref.get(b.prefecture).push(b);
  }
  const lineMembers = new Map(
    (stationLines?.lines ?? []).map((l) => [l.slug, l.stations.map((slug) => bundles.get(slug)).filter(Boolean)])
  );
  for (const b of bundles.values()) {
    b.pref_rank = { prefecture: b.prefecture, ...rankIn(byPref.get(b.prefecture), b) };
    b.line_ranks = b.lines
      .map((l) => {
        const members = lineMembers.get(l.slug) ?? [];
        return members.length >= 3 && members.includes(b) ? { slug: l.slug, name: l.name, ...rankIn(members, b) } : null;
      })
      .filter(Boolean);
  }
}

// 家賃の目安（2026-09-30追加）。市区町村の民営借家の1m²当たり家賃を1Kの広さ（RENT_ROOM_M2）に直し、
// 全掲載駅の中で安い方から何%の位置かを付ける。駅ごとの相場ではなく市区町村の平均であることは画面の文で必ず書く
function buildRentMap(stationRent, rentFactors, stations) {
  const prefOf = new Map(stations.map((s) => [s.slug, s.prefecture]));
  // 都道府県ごとの倍率（無ければ全国一律の RENT_MARKET_FACTOR）
  const factorOf = (slug) => rentFactors?.factors?.[prefOf.get(slug)] ?? RENT_MARKET_FACTOR;
  const monthlyOf = (slug, r) => Math.round((r.yen_per_m2 * RENT_ROOM_M2 * factorOf(slug)) / 100) * 100;
  const entries = Object.entries(stationRent?.stations ?? {}).filter(([slug]) => prefOf.has(slug));
  // 安い方から何%かは、倍率を掛けた後の目安で並べる（都道府県で倍率が違うため）
  const values = entries.map(([slug, r]) => monthlyOf(slug, r)).sort((a, b) => a - b);
  const atMost = (v) => {
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const map = new Map();
  for (const [slug, r] of entries) {
    map.set(slug, {
      area: r.area,
      level: r.level,
      yen_per_m2: r.yen_per_m2,
      // 1Kの広さに直した統計そのままの月の家賃と、募集家賃の水準に直した目安（100円単位）
      stock_monthly: Math.round((r.yen_per_m2 * RENT_ROOM_M2) / 100) * 100,
      monthly: monthlyOf(slug, r),
      factor: factorOf(slug),
      prefecture: prefOf.get(slug),
      room_m2: RENT_ROOM_M2,
      national_yen_per_m2: stationRent.national_yen_per_m2,
      // 全掲載駅を安い順に並べたときの位置（この値以下の駅の割合、%）
      cheap_pct: Math.round((atMost(monthlyOf(slug, r)) / values.length) * 100),
      of: values.length,
      year: stationRent.survey_year,
    });
  }
  return map;
}

// 駅のある市区町村に住んでいる人（2026-09-30追加）。国勢調査の割合に、全掲載駅の中での位置（その値以下の駅の割合、%）を付ける。
// 位置は「若い一人暮らしが多い街」などの言葉を選ぶのに使う（src/stationProfileText.js の peopleTypes）
export const PEOPLE_KEYS = ["single_pct", "young_pct", "kids_pct", "senior_pct", "pop_change_pct"];
function buildPeopleMap(stationPeople, stations) {
  const slugs = new Set(stations.map((s) => s.slug));
  const entries = Object.entries(stationPeople?.stations ?? {}).filter(([slug]) => slugs.has(slug));
  const sorted = Object.fromEntries(
    PEOPLE_KEYS.map((k) => [k, entries.map(([, v]) => v[k]).filter((v) => v !== null).sort((a, b) => a - b)])
  );
  const atMostPct = (k, v) => {
    const values = sorted[k];
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return Math.round((lo / values.length) * 100);
  };
  const prefOf = new Map(stations.map((s) => [s.slug, s.prefecture]));
  const map = new Map();
  for (const [slug, v] of entries) {
    map.set(slug, {
      ...v,
      prefecture: prefOf.get(slug),
      pref_values: stationPeople.prefectures?.[prefOf.get(slug)] ?? null,
      national: stationPeople.national,
      pctl: Object.fromEntries(PEOPLE_KEYS.map((k) => [k, v[k] === null ? null : atMostPct(k, v[k])])),
      of: entries.length,
      census_year: stationPeople.census_year,
      childcare_date: stationPeople.childcare_date,
      childcare_summary: stationPeople.childcare_summary,
    });
  }
  return map;
}

// 同じ路線の大きな駅（2026-09-30追加）。路線ごとに、乗降客数の多い順に自分以外の駅を LINE_HUB_LIMIT 駅まで。
// 路線は正式な路線名でまとめているので（東北本線に京浜東北線・宇都宮線が入るなど）、「乗り換えなしで行ける」とは書かない
const LINE_HUB_LIMIT = 3;
function addLineHubs(bundles, stationLines) {
  const riderOf = (b) => b.public.ridership?.daily ?? 0;
  const byLine = new Map(
    (stationLines?.lines ?? []).map((l) => [
      l.slug,
      l.stations
        .map((slug) => bundles.get(slug))
        .filter((b) => b && riderOf(b) > 0)
        .sort((x, y) => riderOf(y) - riderOf(x)),
    ])
  );
  for (const b of bundles.values()) {
    b.line_hubs = b.lines
      .map((l) => {
        const members = byLine.get(l.slug) ?? [];
        // 同じ場所の別事業者の駅（「大阪駅」と「梅田駅」など、400m以内）は大きな駅に数えない
        const hubs = members
          .filter((h) => h !== b && distanceKm(h, b) > 0.4)
          .slice(0, LINE_HUB_LIMIT)
          .map((h) => ({ slug: h.slug, name: h.name_ja, daily: riderOf(h), km: Math.round(distanceKm(h, b) * 10) / 10 }));
        return hubs.length > 0 ? { slug: l.slug, name: l.name, hubs } : null;
      })
      .filter(Boolean);
  }
}
