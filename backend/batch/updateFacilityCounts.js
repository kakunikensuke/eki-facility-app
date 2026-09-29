/**
 * 駅周辺施設数の集計バッチ
 *
 * 対象駅ごとにOpenStreetMap Overpass APIへ問い合わせ、徒歩5/10/15/20分圏内（半径400/800/
 * 1200/1600m）にあるコンビニ・病院・スーパー・飲食店など18カテゴリ（CATEGORY_TAGS）の件数を
 * 集計してfacility-counts.jsonに保存する。ユーザーの検索リクエストは常にこの事前集計済み
 * JSONを読むだけで、Overpass APIをリアルタイムに叩くことはしない（レート制限対策、
 * 設計書「2. なぜ検索のたびに外部APIを呼ばないか」参照）。
 *
 * 4段階化は2026-08-07に対応（それ以前は徒歩10分のみ）。
 *
 * 2026-09-29、カテゴリを7から18に増やし、取得方法を変えた。
 * 以前は「半径×カテゴリ」ごとに around で数えさせていた（4×7=28個のcount）が、
 * カテゴリを増やすとサーバー側の走査が 4×18=72 回になる。今は1600m圏内の対象を
 * 1回だけまとめて取り（位置つき）、4段階の距離はこちらで数える。Overpass側の走査は
 * カテゴリ数ぶんの1回ずつで済み、段階を増やしても負荷が増えない。
 * 線（way）は中心点の距離で判定する。以前の around は「線のどこかが円に掛かれば数える」
 * だったので、大きな公園などは数がわずかに変わる。
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
// 公開インスタンスは混雑すると429を返し続けて1駅1分以上かかることがある。
// 全駅を手元で取り直すときは、ミラー（例: https://maps.mail.ru/osm/tools/overpass/api/interpreter）を
// 環境変数で指定し、--part で分けて並行に流せるようにしている
const OVERPASS_ENDPOINT = process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter";

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
//
// 2026-09-29に11カテゴリを追加（スコアを6分野で出すため。backend/scoring.js）。
// restaurant は従来どおりカフェを含む（既存の画面と数字の意味を変えないため）。カフェだけの数は
// cafe に別に持ち、「カフェを除く飲食店」は restaurant - cafe で出す。
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

  // ---- 2026-09-29追加 ----
  cafe: [["amenity", "cafe"]],
  // 100円ショップ。OSMではダイソー等が shop=variety_store で登録されている
  variety_store: [["shop", "variety_store"]],
  post_office: [["amenity", "post_office"]],
  bank: [
    ["amenity", "bank"],
    ["amenity", "atm"],
  ],
  laundry: [["shop", "laundry"]],
  // 交番・警察署。OSMでは交番も amenity=police で登録されている
  police: [["amenity", "police"]],
  dentist: [["amenity", "dentist"]],
  // 調剤薬局。ドラッグストア（shop=chemist）とは別
  pharmacy: [["amenity", "pharmacy"]],
  // OSMでは小中高を区別するタグが揃っていないため「学校」としてまとめる
  school: [["amenity", "school"]],
  library: [["amenity", "library"]],
  fitness: [["leisure", "fitness_centre"]],
  public_bath: [["amenity", "public_bath"]],
};

const CATEGORY_NAMES = Object.keys(CATEGORY_TAGS);

const MAX_RADIUS_M = Math.max(...WALK_MINUTES_TIERS) * WALK_SPEED_M_PER_MIN;

// 最大半径の円に入る対象を、カテゴリのタグごとに1回ずつ集めて位置つきで返させる。
// out center は線（way）にも中心点を付ける。点（node）は lat/lon をそのまま持つ
function buildOverpassQuery(lat, lon) {
  // 同じキー（shop / amenity / leisure）の値はまとめて正規表現で1回に探す。
  // 円内の走査はタグの種類ごとに1回ずつ走るので、21種類を別々に書くと重く、公開サーバーで
  // タイムアウト（504）が続いた
  const valuesByKey = new Map();
  for (const tags of Object.values(CATEGORY_TAGS)) {
    for (const [key, value] of tags) {
      if (!valuesByKey.has(key)) valuesByKey.set(key, new Set());
      valuesByKey.get(key).add(value);
    }
  }
  const filters = [...valuesByKey]
    .map(([key, values]) => {
      const pattern = `^(${[...values].join("|")})$`;
      return (
        `  node["${key}"~"${pattern}"](around:${MAX_RADIUS_M},${lat},${lon});\n` +
        `  way["${key}"~"${pattern}"](around:${MAX_RADIUS_M},${lat},${lon});`
      );
    })
    .join("\n");
  // 大規模駅は対象が数千件になるため、タイムアウトは余裕を持たせる
  return `[out:json][timeout:180];\n(\n${filters}\n);\nout tags center;`;
}

function distanceM(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// 1件の対象が当てはまるカテゴリ（銀行とATMを兼ねる等、複数に当たることがある）
function categoriesOf(tags) {
  return CATEGORY_NAMES.filter((name) =>
    CATEGORY_TAGS[name].some(([key, value]) => tags[key] === value)
  );
}

/** Overpassの応答（elements）を4段階×カテゴリの件数にする。テストしやすいよう切り出している */
function countByTier(elements, lat, lon) {
  const tiers = {};
  for (const minutes of WALK_MINUTES_TIERS) {
    tiers[minutes] = {
      radius_m: minutes * WALK_SPEED_M_PER_MIN,
      counts: Object.fromEntries(CATEGORY_NAMES.map((name) => [name, 0])),
    };
  }
  for (const el of elements) {
    const point = el.type === "node" ? el : el.center;
    if (!point || !el.tags) continue;
    const d = distanceM(lat, lon, point.lat, point.lon);
    const names = categoriesOf(el.tags);
    for (const minutes of WALK_MINUTES_TIERS) {
      if (d > minutes * WALK_SPEED_M_PER_MIN) continue;
      for (const name of names) tiers[minutes].counts[name] += 1;
    }
  }
  return tiers;
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
    // タイムアウトなどでサーバーが途中で打ち切ると、200のまま remark にエラーが入る。
    // それを0件として保存すると全カテゴリ0軒の駅ができてしまうので、失敗として扱う
    if (json.remark && /error|timed out/i.test(json.remark)) {
      throw new Error(`Overpass APIが処理を打ち切りました: ${json.remark}`);
    }
    const tiers = countByTier(json.elements || [], station.lat, station.lon);
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

  // --part 2/3 : 駅を3つに分けた2番目だけを処理する（別のエンドポイントで並行に流すため）。
  // --out <path>: 取得できた駅だけをこのファイルに書く。並行に流した複数のプロセスが
  //               同じ facility-counts.json を上書きし合わないようにするため。
  //               あとで scripts/mergeFacilityCounts.js で本体にまとめる
  const partIdx = process.argv.indexOf("--part");
  if (partIdx !== -1) {
    const [k, n] = process.argv[partIdx + 1].split("/").map(Number);
    stations = stations.filter((_, i) => i % n === k - 1);
    console.log(`--part ${k}/${n}: ${stations.length}駅を処理します\n`);
  }
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx === -1 ? OUTPUT_PATH : path.resolve(process.argv[outIdx + 1]);

  let existing = {};
  if (outPath === OUTPUT_PATH && fs.existsSync(OUTPUT_PATH)) {
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
      // 途中で落ちても取れた分が残るよう、20駅ごとに書き出しておく
      if (successCount % 20 === 0) {
        fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n", "utf-8");
      }
    } catch (err) {
      failureCount += 1;
      console.error(`失敗（既存データを保持）: ${err.message}`);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n", "utf-8");
  console.log(`\n完了: 成功${successCount}件 / 失敗${failureCount}件 -> ${outPath}`);
}

if (require.main !== module) {
  module.exports = { buildOverpassQuery, countByTier, fetchCountsForStation, CATEGORY_TAGS };
} else {
main().catch((err) => {
  console.error("バッチ実行中に予期しないエラー:", err);
  process.exit(1);
});
}
