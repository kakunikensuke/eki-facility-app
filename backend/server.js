/**
 * 住みやすさ駅前スコア バックエンドAPI
 *
 * GET /api/stations         -> 対象駅一覧
 * GET /api/facility-counts?station=<slug> -> 指定駅の集計済みカテゴリ別店舗数
 *
 * facility-counts.jsonはOverpass APIへのリアルタイム問い合わせではなく、
 * batch/updateFacilityCounts.jsによる事前集計結果を読むだけ（設計書2章参照）。
 */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 4001;
const STATIONS_PATH = path.join(__dirname, "data", "stations.json");
const FACILITY_COUNTS_PATH = path.join(__dirname, "data", "facility-counts.json");
const UPDATE_CRON = process.env.FACILITY_UPDATE_CRON || "0 3 * * *"; // 既定: 毎日3:00(JST)

app.use(cors());
app.use(express.json());

function loadStations() {
  return JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
}

function loadFacilityCounts() {
  if (!fs.existsSync(FACILITY_COUNTS_PATH)) return {};
  return JSON.parse(fs.readFileSync(FACILITY_COUNTS_PATH, "utf-8"));
}

app.get("/api/stations", (req, res) => {
  const stations = loadStations().map(({ slug, name_ja }) => ({ slug, name_ja }));
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

  res.json({ station, ...record });
});

// 集計バッチを定期実行する（デフォルト毎日3:00 JST）。バッチ本体はOverpass APIへの
// アクセスを含むため、別プロセスとして起動しserver.jsの応答性に影響を与えないようにする。
cron.schedule(UPDATE_CRON, () => {
  console.log(`[cron] facility-counts更新バッチを起動 (${new Date().toISOString()})`);
  const child = spawn("node", [path.join(__dirname, "batch", "updateFacilityCounts.js")], {
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.log(`[cron] facility-counts更新バッチ終了 (code=${code})`);
  });
});

app.listen(PORT, () => {
  console.log(`eki-facility-app backend listening on port ${PORT}`);
});
