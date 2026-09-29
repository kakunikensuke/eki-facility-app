// 駅ごとの表示データ一式（採点・順位・公的データ・写真・似ている駅など）をまとめて作る（2026-09-29追加）。
//
// generateApiData.js（ブラウザに配るJSON）と prerender.js（静的HTML）の両方がこれを使う。
// 以前は両方のスクリプトがそれぞれ採点や順位を組み立てていて、片方だけ直すと
// 画面とクローラの見る中身がずれる作りだった。今はここで1回だけ作り、両方が同じ物を読む。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { findNearbyStations, formatDistance } from "../src/nearbyStations.js";
import { DOMAINS, ITEMS } from "../src/livabilityDefs.js";

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

export function buildAll({ stations, facilityCounts, stationPublic, stationPhotos, stationHazard, stationLines }) {
  assertDefsInSync();

  const scoredByTier = livability.scoreAllTiers(stations, facilityCounts);
  const publicBySlug = livability.publicRanks(stationPublic.stations || {});
  const similarBySlug = buildSimilarMap(stations, facilityCounts, DEFAULT_WALK_MINUTES);
  const defaultScores = scoredByTier[DEFAULT_WALK_MINUTES];

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
    const nearestScore = nearestStation && defaultScores.get(nearestStation.station.slug);
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
      photos: stationPhotos[station.slug]?.photos ?? [],
      // 写真を載せているWikipedia記事の題名（出典の表示に使う）
      photo_article: stationPhotos[station.slug]?.article ?? null,
      concentration: getConcentration(record.tiers),
      category_reach: getCategoryReach(record.tiers, DEFAULT_WALK_MINUTES, REACH_KEYS),
      nearest,
      hazard: stationHazard?.stations?.[station.slug] ?? null,
      lines: (stationLines?.station_lines?.[station.slug] ?? []).map((lineSlug) => ({
        slug: lineSlug,
        name: stationLines.lines.find((l) => l.slug === lineSlug).name,
      })),
      similar_stations: similarBySlug.get(station.slug) ?? [],
      updated_at: record.updated_at,
      source: record.source,
    });
  }

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
