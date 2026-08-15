// APIの応答を静的JSONとして書き出す（出力先: frontend/public/api/）。
//
// なぜ必要か（2026-08-15）:
// バックエンド（backend/server.js）は動的な処理を一切していない。リポジトリ内の
// 静的JSON（stations.json / facility-counts.json）を読んで決まった計算を返すだけで、
// 書き込みも認証も無く、データが変わるのは1日1回のGitHub Actionsのときだけ。
// それをRenderの常時起動サービスで賄っていたため、無料枠（アカウント単位で
// 月750インスタンス時間）を圧迫していた。ロッカーアプリと合わせて2サービスを
// 24時間起こしていると1日48時間消費し、15.6日で使い切って両アプリのAPIが止まる。
//
// ビルド時に全部JSONとして出しておけば、Cloudflare Pagesが配信できる。
// Renderもスリープ対策のUptimeRobotも要らなくなり、コールドスタートも原理的に消える。
//
// 応答の形は backend/server.js のエンドポイントと**完全に同じにすること**。
// ズレるとフロントが壊れる。計算そのものはbackendのモジュールを直接使って
// 二重実装を避けている（プリレンダ scripts/prerender.js と同じ方針）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { calculateScore, SCORE_TARGETS_BY_WALK_MINUTES } = require("../../backend/scoring.js");
const {
  getStationTagKeys,
  TAG_THRESHOLDS_BY_WALK_MINUTES,
} = require("../../backend/stationTags.js");
const { normalizeRecord, DEFAULT_WALK_MINUTES } = require("../../backend/facilityRecord.js");
const { buildStationScores } = require("../../backend/stationScores.js");
const { getConcentration, buildRankMap } = require("../../backend/stationProfile.js");

const DATA_DIR = path.join(__dirname, "..", "..", "backend", "data");
const OUT_DIR = path.join(__dirname, "..", "public", "api");

const stations = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "stations.json"), "utf-8"));
const facilityCounts = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "facility-counts.json"), "utf-8")
);

function writeJson(relativePath, value) {
  const outPath = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(value));
}

// 生成物は毎回作り直す。駅を減らしたときに古いJSONが残ると、
// 一覧に無い駅のページだけ生き続けることになる
fs.rmSync(OUT_DIR, { recursive: true, force: true });

// --- GET /api/stations 相当 ---------------------------------------------------
// lat/lonも返すのは、駅ページの「近くの駅」リンクをフロント側だけで組み立てるため
writeJson(
  "stations.json",
  stations.map(({ slug, name_ja, lat, lon }) => ({ slug, name_ja, lat, lon }))
);

// --- GET /api/station-scores 相当 ---------------------------------------------
writeJson("station-scores.json", {
  walk_minutes: DEFAULT_WALK_MINUTES,
  stations: buildStationScores(stations, facilityCounts),
});

// --- GET /api/facility-counts?station=<slug> 相当 ------------------------------
// 順位表は1度だけ作る（駅ごとに引き直すと全駅の再計算を349回繰り返すことになる）
const rankBySlug = buildRankMap(stations, facilityCounts);

let written = 0;
let skipped = 0;
for (const station of stations) {
  const record = facilityCounts[station.slug];
  // 集計データがまだ無い駅はファイルを作らない（フロント側は「準備できていません」を出す）
  if (!record) {
    skipped++;
    continue;
  }

  const normalized = normalizeRecord(record);
  const tiers = {};
  for (const [key, tier] of Object.entries(normalized.tiers)) {
    const walkMinutes = Number(key);
    tiers[key] = {
      walk_minutes: walkMinutes,
      radius_m: tier.radius_m,
      counts: tier.counts,
      score: calculateScore(tier.counts, walkMinutes),
      targets: SCORE_TARGETS_BY_WALK_MINUTES[walkMinutes],
      tag_keys: getStationTagKeys(tier.counts, walkMinutes),
      tag_thresholds: TAG_THRESHOLDS_BY_WALK_MINUTES[walkMinutes],
    };
  }

  writeJson(`facility-counts/${station.slug}.json`, {
    station: station.slug,
    tiers,
    available_walk_minutes: Object.keys(tiers)
      .map(Number)
      .sort((a, b) => a - b),
    default_walk_minutes: DEFAULT_WALK_MINUTES,
    rank: rankBySlug.get(station.slug) ?? null,
    concentration: getConcentration(normalized.tiers),
    updated_at: normalized.updated_at,
    source: normalized.source,
  });
  written++;
}

console.log(
  `APIの静的JSONを生成しました（駅${written}件 + 一覧2件 / データ未整備でスキップ ${skipped}駅、出力先 public/api/）`
);
