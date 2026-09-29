/**
 * 駅ごとに「駅から近い施設」を名前つきで選び、backend/data/station-nearby.json に書く（2026-09-30追加）。
 *
 * なぜ要るか: 駅ページは施設の軒数と点数の表が中心で、どの駅も同じ形の数字が並ぶだけだった。
 * 「一番近いスーパーは〇〇（約350m）」は駅ごとに必ず中身が変わり、住む場所を選ぶ人が実際に知りたいこと。
 *
 * 元データは batch/countFacilitiesFromPbf.js が保存した施設の一時ファイル
 * （D:/ClaudeData/osm/eki-elements-<pbfの名前>.json。施設の名前 name・brand を含む版）。
 * 施設の種類の判定は updateFacilityCounts.js の CATEGORY_TAGS と同じ。
 *
 * - 距離は駅の座標からの直線距離（線の施設は外枠の中心）。軒数の集計と同じ測り方
 * - 1種類につき、名前の分かる施設を近い順に最大 TOP_N 件。同じ名前（片方がもう片方を含む名前も）で近接しているもの（点と線の二重登録など）は1件にする
 * - 名前の有無にかかわらず、その種類で最も近い施設までの距離も持つ（「名前は分からないがもっと近くにある」を隠さない）
 *
 * 実行:
 *   node backend/scripts/buildNearbyFacilities.js <eki-elements-*.json>
 */

const fs = require("fs");
const path = require("path");
const { CATEGORY_TAGS } = require("../batch/updateFacilityCounts");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-nearby.json");

// 徒歩20分（1600m）まで。軒数の集計と同じ範囲
const MAX_RADIUS_M = 1600;
const TOP_N = 3;
// 名前が同じか、片方がもう片方を含む（「市立気比中学校」と「敦賀市立 気比中学校」）施設で、
// 駅からの距離の差がこれより小さいものは同じ施設の二重登録とみなす
const SAME_PLACE_M = 150;
const compact = (name) => name.replace(/[\s・]/g, "");
function sameFacility(a, b) {
  const x = compact(a.name);
  const y = compact(b.name);
  return (x.includes(y) || y.includes(x)) && Math.abs(a.m - b.m) < SAME_PLACE_M;
}
// 名前を並べる種類（飲食店・カフェ・銀行・コインランドリーは件数が多いか名前が暮らしの判断に役立たないので除く）
const LISTED = [
  "supermarket",
  "convenience_store",
  "drugstore",
  "variety_store",
  "hospital",
  "dentist",
  "pharmacy",
  "nursery",
  "school",
  "library",
  "post_office",
  "police",
  "park",
  "fitness",
  "public_bath",
];
const GRID_DEG = 0.01;

function distanceM(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function categoriesOf(tags) {
  return LISTED.filter((name) => CATEGORY_TAGS[name].some(([k, v]) => tags[k] === v));
}

function labelOf(tags) {
  // 「大黒屋;」「伊予の湯治場;喜助の湯」のように複数の名前が「;」でつながっているものは最初の名前だけ使う
  const name = (tags.name ?? tags.brand ?? "").split(";")[0].replace(/\s+/g, " ").trim();
  // 「公園」「駐車場」のような種類名だけの登録や、長すぎる名前は名前として使わない
  if (!name || name.length > 40 || /^(公園|広場|病院|学校|保育園|幼稚園|郵便局|交番|薬局|図書館)$/.test(name)) return null;
  return name;
}

function main() {
  const cachePath = process.argv[2];
  if (!cachePath) {
    console.error("使い方: node backend/scripts/buildNearbyFacilities.js <eki-elements-*.json>");
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  if (cache.version !== 2) {
    console.error("施設の一時ファイルに名前が入っていません。countFacilitiesFromPbf.js を実行し直してください");
    process.exit(1);
  }
  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));

  const grid = new Map();
  for (const el of cache.elements) {
    const p = el.type === "node" ? el : el.center;
    const cats = categoriesOf(el.tags);
    if (cats.length === 0) continue;
    const item = { lat: p.lat, lon: p.lon, cats, name: labelOf(el.tags) };
    const key = `${Math.floor(p.lat / GRID_DEG)},${Math.floor(p.lon / GRID_DEG)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(item);
  }

  const out = {};
  let named = 0;
  let slots = 0;
  for (const s of stations) {
    const gy = Math.floor(s.lat / GRID_DEG);
    const gx = Math.floor(s.lon / GRID_DEG);
    const near = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (const it of grid.get(`${gy + dy},${gx + dx}`) ?? []) {
          const m = distanceM(s.lat, s.lon, it.lat, it.lon);
          if (m <= MAX_RADIUS_M) near.push({ ...it, m });
        }
      }
    }
    near.sort((a, b) => a.m - b.m);
    const result = {};
    for (const cat of LISTED) {
      const all = near.filter((it) => it.cats.includes(cat));
      if (all.length === 0) continue;
      const top = [];
      for (const it of all) {
        if (!it.name) continue;
        if (top.some((t) => sameFacility(t, it))) continue;
        top.push(it);
        if (top.length >= TOP_N) break;
      }
      result[cat] = {
        nearest_m: Math.round(all[0].m / 10) * 10,
        named: top.map((t) => [t.name, Math.round(t.m / 10) * 10]),
      };
      slots++;
      if (top.length > 0) named++;
    }
    out[s.slug] = result;
  }

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        source: "OpenStreetMap contributors (ODbL)",
        source_file: path.basename(cachePath),
        radius_m: MAX_RADIUS_M,
        stations: out,
      },
      null,
      0
    ) + "\n"
  );
  console.log(
    `station-nearby.json を書き出しました（${stations.length}駅、施設の種類×駅 ${slots}件のうち名前の分かる施設あり ${named}件）`
  );
}

main();
