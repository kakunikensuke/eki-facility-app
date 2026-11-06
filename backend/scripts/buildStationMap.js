/**
 * 駅ページの「駅の周りの地図」に置く施設の位置を、backend/data/station-map.json に書く（2026-11-06追加）。
 *
 * なぜ要るか: 駅ページは軒数と点数と、駅から近い施設の名前の一覧だけで、「どの方向に何があるか」が
 * 分からなかった。駅の北に店が固まっていて南は住宅地、といった違いは数字の表からは読めない。
 *
 * 元データは buildNearbyFacilities.js と同じ施設の一時ファイル（D:/ClaudeData/osm/eki-elements-*.json）。
 *
 * - 種類は暮らしの判断に使う6つ（MAP_CATS）。駅から徒歩10分（800m）以内を近い順に最大 MAP_N 件
 * - 名前の無い施設も載せる（地図では「名前の登録なし」）。同じ施設の二重登録は buildNearbyFacilities.js と同じ基準で1件に
 * - 位置は駅からのずれを 1e-5 度単位の整数で持つ（約1m。ファイルを小さくするため）
 *
 * 実行（施設数・駅を取り直したら作り直す）:
 *   node backend/scripts/buildStationMap.js <eki-elements-*.json>
 */

const fs = require("fs");
const path = require("path");
const { loadFacilityGrid, facilitiesNear, sameFacility } = require("./buildNearbyFacilities");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-map.json");

// 画面の凡例の順。frontend/src/stationMap.js の MAP_CATS と同じ並びにすること
const MAP_CATS = ["supermarket", "convenience_store", "drugstore", "hospital", "nursery", "park"];
const RADIUS_M = 800;
const MAP_N = 6;
// 名前の無い施設どうしは名前で見分けられないので、同じ種類で20m以内なら二重登録とみなす
const SAME_SPOT_M = 20;

function main() {
  const cachePath = process.argv[2];
  if (!cachePath) {
    console.error("使い方: node backend/scripts/buildStationMap.js <eki-elements-*.json>");
    process.exit(1);
  }
  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const grid = loadFacilityGrid(cachePath, MAP_CATS);

  const out = {};
  let points = 0;
  let empty = 0;
  for (const s of stations) {
    const near = facilitiesNear(grid, s, RADIUS_M);
    const rows = [];
    MAP_CATS.forEach((cat, ci) => {
      const picked = [];
      for (const it of near) {
        if (!it.cats.includes(cat)) continue;
        const dup = picked.some((p) =>
          p.name && it.name ? sameFacility(p, it) : Math.abs(p.lat - it.lat) * 111000 < SAME_SPOT_M && Math.abs(p.lon - it.lon) * 91000 < SAME_SPOT_M
        );
        if (dup) continue;
        picked.push(it);
        if (picked.length >= MAP_N) break;
      }
      for (const p of picked) {
        rows.push([ci, Math.round((p.lat - s.lat) * 1e5), Math.round((p.lon - s.lon) * 1e5), Math.round(p.m / 10) * 10, p.name ?? 0]);
      }
    });
    if (rows.length === 0) empty++;
    points += rows.length;
    out[s.slug] = rows;
  }

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({
      source: "OpenStreetMap contributors (ODbL)",
      source_file: path.basename(cachePath),
      radius_m: RADIUS_M,
      cats: MAP_CATS,
      // 各行: [種類の番号, 緯度のずれ(1e-5度), 経度のずれ(1e-5度), 駅からの距離(m), 名前 or 0]
      stations: out,
    }) + "\n"
  );
  console.log(`station-map.json を書き出しました（${stations.length}駅・${points}か所、施設の無い駅 ${empty}）`);
}

main();
