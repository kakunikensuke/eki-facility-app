/**
 * 駅周辺施設数の集計バッチ
 *
 * 対象駅ごとにOpenStreetMap Overpass APIへ問い合わせ、徒歩10分圏内（半径800m）にある
 * コンビニ・病院・スーパー・飲食店の件数を集計してfacility-counts.jsonに保存する。
 * ユーザーの検索リクエストは常にこの事前集計済みJSONを読むだけで、Overpass APIを
 * リアルタイムに叩くことはしない（レート制限対策、設計書「2. なぜ検索のたびに
 * 外部APIを呼ばないか」参照）。
 *
 * 取得に失敗した駅は既存データを保持し、他の駅の処理は継続する。
 */

const fs = require("fs");
const path = require("path");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "facility-counts.json");
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

const WALK_MINUTES = 10;
const WALK_SPEED_M_PER_MIN = 80;
const RADIUS_M = WALK_MINUTES * WALK_SPEED_M_PER_MIN;

// Overpass APIへのリクエスト間隔（fair use policy配慮）
const REQUEST_INTERVAL_MS = 8000;

// 429（レート制限）時のリトライ設定。公開インスタンスは混雑で一時的に429を返すことがあるため、
// 待機時間を倍々にしながら再試行する。
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 15000;

// カテゴリ→OSMタグの対応（要件定義書5章で確定: クリニックは病院に含む、カフェ・ファストフードは飲食店に含む）
const CATEGORY_TAGS = {
  convenience_store: [["shop", "convenience"]],
  supermarket: [["shop", "supermarket"]],
  hospital: [
    ["amenity", "hospital"],
    ["amenity", "clinic"],
  ],
  restaurant: [
    ["amenity", "restaurant"],
    ["amenity", "cafe"],
    ["amenity", "fast_food"],
  ],
};

const CATEGORY_NAMES = Object.keys(CATEGORY_TAGS);

function buildOverpassQuery(lat, lon, radiusM) {
  const setBlocks = CATEGORY_NAMES.map((name) => {
    const filters = CATEGORY_TAGS[name]
      .map(
        ([key, value]) =>
          `  node["${key}"="${value}"](around:${radiusM},${lat},${lon});\n` +
          `  way["${key}"="${value}"](around:${radiusM},${lat},${lon});`
      )
      .join("\n");
    return `(\n${filters}\n)->.${name};`;
  }).join("\n");

  const countLines = CATEGORY_NAMES.map((name) => `.${name} out count;`).join("\n");

  return `[out:json][timeout:25];\n${setBlocks}\n${countLines}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowJst() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}

async function fetchCountsForStation(station) {
  const query = buildOverpassQuery(station.lat, station.lon, RADIUS_M);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "eki-facility-app-batch/1.0 (personal non-commercial project)",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      process.stdout.write(`429(レート制限)、${delay / 1000}秒待って再試行... `);
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Overpass APIエラー: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const countElements = (json.elements || []).filter((el) => el.type === "count");

    if (countElements.length !== CATEGORY_NAMES.length) {
      throw new Error(
        `想定外のcount要素数（期待値${CATEGORY_NAMES.length}件、実際${countElements.length}件）`
      );
    }

    const counts = {};
    CATEGORY_NAMES.forEach((name, i) => {
      counts[name] = Number(countElements[i].tags.total);
    });
    return counts;
  }

  throw new Error("Overpass APIエラー: 429 Too Many Requests（リトライ上限に到達）");
}

async function main() {
  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));

  let existing = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
  }

  const results = { ...existing };
  let successCount = 0;
  let failureCount = 0;

  for (const station of stations) {
    process.stdout.write(`[${station.slug}] 取得中... `);
    try {
      const counts = await fetchCountsForStation(station);
      results[station.slug] = {
        walk_minutes: WALK_MINUTES,
        radius_m: RADIUS_M,
        counts,
        updated_at: nowJst(),
        source: "OpenStreetMap contributors (ODbL)",
      };
      successCount += 1;
      console.log("OK", counts);
    } catch (err) {
      failureCount += 1;
      console.error(`失敗（既存データを保持）: ${err.message}`);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2) + "\n", "utf-8");
  console.log(`\n完了: 成功${successCount}件 / 失敗${failureCount}件 -> ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("バッチ実行中に予期しないエラー:", err);
  process.exit(1);
});
