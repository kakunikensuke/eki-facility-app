/**
 * 住みやすさ駅前スコア バックエンドAPI
 *
 * GET /api/stations         -> 対象駅一覧
 * GET /api/facility-counts?station=<slug> -> 指定駅の徒歩5/10/15/20分圏それぞれの
 *                                            カテゴリ別店舗数とスコア
 *
 * facility-counts.jsonはOverpass APIへのリアルタイム問い合わせではなく、
 * batch/updateFacilityCounts.jsによる事前集計結果を読むだけ（設計書2章参照）。
 * 更新バッチのスケジューリングはGitHub Actionsの定期実行に委譲しており、
 * このプロセス内では行わない（設計書13章参照。無料ホスティングのスリープ中は
 * プロセス内cronが発火しないため）。
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { calculateScore, SCORE_TARGETS_BY_WALK_MINUTES } = require("./scoring");
const { getStationTagKeys, TAG_THRESHOLDS_BY_WALK_MINUTES } = require("./stationTags");
const { normalizeRecord, DEFAULT_WALK_MINUTES } = require("./facilityRecord");

const app = express();
const PORT = process.env.PORT || 4001;
const STATIONS_PATH = path.join(__dirname, "data", "stations.json");
const FACILITY_COUNTS_PATH = path.join(__dirname, "data", "facility-counts.json");

app.use(cors());
app.use(express.json());

function loadStations() {
  return JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
}

function loadFacilityCounts() {
  if (!fs.existsSync(FACILITY_COUNTS_PATH)) return {};
  return JSON.parse(fs.readFileSync(FACILITY_COUNTS_PATH, "utf-8"));
}

// lat/lonも返すのは、駅ページの「近くの駅」リンク（frontend/src/nearbyStations.js）を
// フロント側だけで組み立てられるようにするため。349駅ぶんでも増加は数KB程度。
app.get("/api/stations", (req, res) => {
  const stations = loadStations().map(({ slug, name_ja, lat, lon }) => ({
    slug,
    name_ja,
    lat,
    lon,
  }));
  res.json(stations);
});

app.get("/api/facility-counts", (req, res) => {
  const { station } = req.query;
  if (!station) {
    return res.status(400).json({ error: "station クエリパラメータは必須です" });
  }

  const stations = loadStations();
  const stationExists = stations.some((s) => s.slug === station);
  if (!stationExists) {
    return res.status(404).json({ error: "指定された駅は対象外です" });
  }

  const counts = loadFacilityCounts();
  const record = counts[station];
  if (!record) {
    return res.status(404).json({ error: "この駅の集計データはまだ準備できていません" });
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
      // 一言コメントの「充実している/少なめ」判定に使う。フロント側で同じ値を持たずに済むよう返す
      targets: SCORE_TARGETS_BY_WALK_MINUTES[walkMinutes],
      tag_keys: getStationTagKeys(tier.counts, walkMinutes),
      // スコア対象外カテゴリ（公園・保育園等）の「多い」基準。一言コメントの補足文で使う
      tag_thresholds: TAG_THRESHOLDS_BY_WALK_MINUTES[walkMinutes],
    };
  }

  res.json({
    station,
    tiers,
    // 集計途中の駅は一部の段階しか持たないことがあるため、実際に返せる段階も明示する
    available_walk_minutes: Object.keys(tiers).map(Number).sort((a, b) => a - b),
    default_walk_minutes: DEFAULT_WALK_MINUTES,
    updated_at: normalized.updated_at,
    source: normalized.source,
  });
});

app.listen(PORT, () => {
  console.log(`eki-facility-app backend listening on port ${PORT}`);
});
