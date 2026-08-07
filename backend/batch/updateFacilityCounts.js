/**
 * 駅周辺施設数の集計バッチ
 *
 * 対象駅ごとにOpenStreetMap Overpass APIへ問い合わせ、徒歩5/10/15/20分圏内（半径400/800/
 * 1200/1600m）にあるコンビニ・病院・スーパー・飲食店・ドラッグストア・公園・保育園の件数を
 * 集計してfacility-counts.jsonに保存する。ユーザーの検索リクエストは常にこの事前集計済み
 * JSONを読むだけで、Overpass APIをリアルタイムに叩くことはしない（レート制限対策、
 * 設計書「2. なぜ検索のたびに外部APIを呼ばないか」参照）。
 *
 * 4段階化は2026-08-07に対応（それ以前は徒歩10分のみ）。1駅あたりのリクエストは1回のまま
 * （4半径×7カテゴリ=28個のcountを1クエリで取得する）なので、Overpass APIへの負荷は
 * 段階を増やしても変わらない。
 *
 * ドラッグストア・公園・保育園は住みやすさスコア（scoring.js）には含めない表示専用
 * カテゴリ（2026-07-16追加、要件定義書8.1参照）。
 *
 * 取得に失敗した駅は既存データを保持し、他の駅の処理は継続する。
 */

const fs = require("fs");
const path = require("path");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "facility-counts.json");
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// 集計する徒歩分数の段階。半径は「徒歩1分=80m」で換算する（要件定義書5章）。
const WALK_MINUTES_TIERS = [5, 10, 15, 20];
const WALK_SPEED_M_PER_MIN = 80;

// Overpass APIへのリクエスト間隔（fair use policy配慮）。4段階化でクエリが重くなり
// サーバー側の処理時間が延びたため、2026-08-07に8秒から10秒へ引き上げた。
const REQUEST_INTERVAL_MS = 10000;

// 一時エラー時のリトライ設定。公開インスタンスは混雑時に429（レート制限）を返すほか、
// 重いクエリでは504（Gateway Timeout）や503を返すことがある。いずれも再試行で回復する
// 一過性のものなので、待機時間を倍々にしながら再試行する。
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 15000;
const RETRIABLE_STATUSES = [429, 500, 502, 503, 504];

// カテゴリ→OSMタグの対応（要件定義書5章で確定: クリニックは病院に含む、カフェ・ファストフードは飲食店に含む）
// drugstore/park/nurseryは2026-07-16追加。スコア非対象の表示専用カテゴリ（要件定義書8.1）。
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
  drugstore: [["shop", "chemist"]],
  park: [["leisure", "park"]],
  // OSM上では保育園・幼稚園を区別するタグがなく、いずれもamenity=kindergartenで
  // 登録されている(池袋駅周辺で実データ確認済み、2026-07-16)。区別できないため
  // 「保育園・幼稚園」として統合表示する。
  nursery: [["amenity", "kindergarten"]],
};

const CATEGORY_NAMES = Object.keys(CATEGORY_TAGS);

// 4段階×7カテゴリ=28個のcountを1クエリで取得する。out countの出力順はクエリ内の
// 記述順と一致するため、後段（fetchCountsForStation）で同じ順に読み出して対応づける。
function buildOverpassQuery(lat, lon) {
  const setBlocks = [];
  const countLines = [];

  for (const minutes of WALK_MINUTES_TIERS) {
    const radiusM = minutes * WALK_SPEED_M_PER_MIN;
    for (const name of CATEGORY_NAMES) {
      const setName = `${name}_${minutes}`;
      const filters = CATEGORY_TAGS[name]
        .map(
          ([key, value]) =>
            `  node["${key}"="${value}"](around:${radiusM},${lat},${lon});\n` +
            `  way["${key}"="${value}"](around:${radiusM},${lat},${lon});`
        )
        .join("\n");
      setBlocks.push(`(\n${filters}\n)->.${setName};`);
      countLines.push(`.${setName} out count;`);
    }
  }

  // 半径1600mの大規模駅は集計に10秒強かかるため、タイムアウトは余裕を持たせる
  return `[out:json][timeout:180];\n${setBlocks.join("\n")}\n${countLines.join("\n")}`;
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
  const query = buildOverpassQuery(station.lat, station.lon);
  const expectedCount = CATEGORY_NAMES.length * WALK_MINUTES_TIERS.length;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "eki-facility-app-batch/1.0 (personal non-commercial project)",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (RETRIABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      process.stdout.write(`${response.status}、${delay / 1000}秒待って再試行... `);
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Overpass APIエラー: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const countElements = (json.elements || []).filter((el) => el.type === "count");

    if (countElements.length !== expectedCount) {
      throw new Error(
        `想定外のcount要素数（期待値${expectedCount}件、実際${countElements.length}件）`
      );
    }

    const tiers = {};
    let i = 0;
    for (const minutes of WALK_MINUTES_TIERS) {
      const counts = {};
      for (const name of CATEGORY_NAMES) {
        counts[name] = Number(countElements[i].tags.total);
        i += 1;
      }
      tiers[minutes] = { radius_m: minutes * WALK_SPEED_M_PER_MIN, counts };
    }
    return tiers;
  }

  throw new Error("Overpass APIエラー: リトライ上限に到達");
}

// 全349駅の実行は2時間以上かかるため、対象を絞る手段を用意しておく。
//   --limit 3            先頭3駅だけ処理する（動作確認用）
//   --only ikebukuro,ueno 指定した駅だけ処理する（504等で失敗した駅の再取得用）
// 部分失敗を許容する設計（失敗駅は既存データを保持）なので、失敗分だけ追いかけられる必要がある。
function parseLimit(argv) {
  const idx = argv.indexOf("--limit");
  if (idx === -1) return null;
  const value = Number(argv[idx + 1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseOnly(argv) {
  const idx = argv.indexOf("--only");
  if (idx === -1) return null;
  const slugs = (argv[idx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return slugs.length > 0 ? slugs : null;
}

async function main() {
  const allStations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const only = parseOnly(process.argv);
  const limit = parseLimit(process.argv);

  let stations = allStations;
  if (only) {
    stations = allStations.filter((s) => only.includes(s.slug));
    const missing = only.filter((slug) => !allStations.some((s) => s.slug === slug));
    if (missing.length > 0) {
      console.warn(`駅マスタに存在しないslugは無視します: ${missing.join(", ")}`);
    }
    console.log(`--only: ${stations.length}駅のみ処理します\n`);
  } else if (limit) {
    stations = allStations.slice(0, limit);
    console.log(`--limit ${limit}: 先頭${stations.length}駅のみ処理します\n`);
  }

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
      const tiers = await fetchCountsForStation(station);
      results[station.slug] = {
        walk_speed_m_per_min: WALK_SPEED_M_PER_MIN,
        tiers,
        updated_at: nowJst(),
        source: "OpenStreetMap contributors (ODbL)",
      };
      successCount += 1;
      const summary = WALK_MINUTES_TIERS.map(
        (m) => `${m}分:${Object.values(tiers[m].counts).reduce((a, b) => a + b, 0)}件`
      ).join(" ");
      console.log(`OK ${summary}`);
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
