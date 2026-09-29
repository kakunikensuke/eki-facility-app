/**
 * 国土数値情報（国土交通省）の公開データを駅ごとにまとめ、backend/data/station-public.json に書き出す
 * （2026-09-29追加）。
 *
 * 使うデータ（どちらもオープンデータ CC BY 4.0。出典表示が必要）:
 * - 駅別乗降客数（S12）: 駅の1日の乗降客数。同じ場所の全事業者・全路線を合計する
 * - 地価公示（L01）: 駅から1.6km（徒歩20分）以内の「住宅地」の標準地の1m²あたり価格の中央値
 *
 * 店の数だけだと「便利だが高い駅」と「便利で手頃な駅」が区別できない。家賃の相場そのものは
 * 無料で使えるデータが無いため、公的な住宅地の地価を目安として並べる。
 *
 * 元データは大きい（合わせて約30MB）ためリポジトリに入れない。年1回、国土数値情報の
 * ダウンロードサービスから新しい版を取ってきて、このスクリプトを実行し直す。
 *   node backend/scripts/importPublicData.js <S12のGeoJSON> <L01のGeoJSON>
 * 例: S12-25_NumberOfPassengers.geojson（2024年度） / L01-26.geojson（2026年1月1日時点）
 */

const fs = require("fs");
const path = require("path");

const [, , s12Path, l01Path] = process.argv;
if (!s12Path || !l01Path) {
  console.error("使い方: node backend/scripts/importPublicData.js <S12のGeoJSON> <L01のGeoJSON>");
  process.exit(1);
}

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-public.json");

// 乗降客数を同じ駅とみなす距離。同名駅は全国に多い（京橋・日本橋など）ので名前と距離の両方で合わせる
const RIDERSHIP_MATCH_KM = 1.0;
// 地価を集める範囲（徒歩20分）。住宅地の標準地が少ない都心の駅では、これで数地点になる
const LAND_RADIUS_KM = 1.6;
// 中央値を出す最低地点数。1地点だけだと、その土地の個別事情がそのまま駅の値になってしまう
const LAND_MIN_POINTS = 2;

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 「東急 渋谷駅」「京王府中駅」→「渋谷」「府中」。乗降客数データは事業者名を別の列に持つ。
// 「ケ」と「ヶ」は表記揺れ（茅ケ崎/茅ヶ崎）なので揃えて比べる
const OPERATOR_PREFIXES = ["京王", "京阪", "阪急", "阪神", "東急", "西武", "東武", "小田急", "京急", "京成", "南海", "近鉄"];
function normalize(name) {
  // 「祗」と「祇」も同じ字とみなす（S12は「下祗園」、駅名は「下祇園」）
  return name.normalize("NFKC").replace(/ヶ/g, "ケ").replace(/ヵ/g, "カ").replace(/祗/g, "祇");
}
function nameCandidates(nameJa) {
  // 同名の駅を区別する括弧書き（「尼崎駅（阪神）」「今里駅（Osaka Metro）」）は比べる前に外す
  const base = nameJa.replace(/（[^）]*）$/, "").replace(/^.*\s/, "").replace(/(駅|停留場)$/, "");
  const names = [base];
  for (const prefix of OPERATOR_PREFIXES) {
    if (base.startsWith(prefix) && base.length > prefix.length) names.push(base.slice(prefix.length));
  }
  return names.map(normalize);
}

// 名前が合わない（「なんば」と「難波」など）ときに、同じ駅とみなしてよい近さ
const RIDERSHIP_FALLBACK_KM = 0.3;
// 都心のオフィス街（東京・有楽町など）は徒歩20分以内に住宅地の標準地がほとんど無い。
// そのときだけ範囲を倍にして、広げたことは radius_m で画面に出す
const LAND_WIDE_RADIUS_KM = 3.2;

const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
const s12 = JSON.parse(fs.readFileSync(s12Path, "utf-8")).features;
const l01 = JSON.parse(fs.readFileSync(l01Path, "utf-8")).features;

// --- 乗降客数 ---------------------------------------------------------------
// S12は「駅×路線」の行。最新年度の列は S12_058（データ有無: 1=あり）・S12_061（乗降客数）。
// 同じ駅の別路線の数字が他の行に含まれている行は有無コードが1以外になっているので、1の行だけ足す。
// 駅グループコード（S12_001g）で、同じ場所にある他事業者の駅をまとめる。
const groups = new Map();
for (const f of s12) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates[0];
  if (!groups.has(p.S12_001g)) {
    groups.set(p.S12_001g, { name: p.S12_001, lat, lon, total: 0, published: false, operators: new Set() });
  }
  const g = groups.get(p.S12_001g);
  if (p.S12_058 === 1 && p.S12_061 > 0) {
    g.total += p.S12_061;
    g.published = true;
    g.operators.add(p.S12_002);
  }
}
const groupList = [...groups.values()];

function ridershipOf(station) {
  const names = nameCandidates(station.name_ja);
  const near = groupList
    .map((g) => ({ g, km: distanceKm(station, g) }))
    .filter((c) => c.km <= RIDERSHIP_MATCH_KM)
    .sort((a, b) => a.km - b.km);
  const byName = near.find((c) => names.includes(normalize(c.g.name)));
  // 名前で見つからないときは、すぐ近くの駅（別名の乗換駅を含む）をまとめて数える。
  // 1つだけ拾うと「Osaka Metro なんば駅」に近鉄だけの数字が付く、といったことが起きる
  const hits = byName ? [byName.g] : near.filter((c) => c.km <= RIDERSHIP_FALLBACK_KM).map((c) => c.g);
  const published = hits.filter((g) => g.published);
  // 小さな駅は事業者が数字を公表していない（データ上は0）。その場合は「無い」として扱う
  if (published.length === 0) return null;
  return {
    daily: published.reduce((a, g) => a + g.total, 0),
    operators: [...new Set(published.flatMap((g) => [...g.operators]))],
  };
}

// --- 地価 -------------------------------------------------------------------
// L01_002 が用途（000=住宅地）、L01_008 が1m²あたりの価格（円）、L01_009 が前年比（%）
const residential = l01
  .filter((f) => f.properties.L01_002 === "000" && f.properties.L01_008 > 0)
  .map((f) => ({
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    price: f.properties.L01_008,
    change: f.properties.L01_009,
    year: f.properties.L01_007,
  }));

function landOf(station) {
  let radiusKm = LAND_RADIUS_KM;
  let near = residential.filter((p) => distanceKm(station, p) <= radiusKm);
  if (near.length < LAND_MIN_POINTS) {
    radiusKm = LAND_WIDE_RADIUS_KM;
    near = residential.filter((p) => distanceKm(station, p) <= radiusKm);
  }
  if (near.length < LAND_MIN_POINTS) return null;
  return {
    median_yen_per_m2: Math.round(median(near.map((p) => p.price))),
    change_pct: Math.round(median(near.map((p) => p.change)) * 10) / 10,
    points: near.length,
    radius_m: radiusKm * 1000,
    year: near[0].year,
  };
}

// --- 出力 -------------------------------------------------------------------
const out = {};
let ridershipHit = 0;
let landHit = 0;
for (const station of stations) {
  const ridership = ridershipOf(station);
  const land = landOf(station);
  if (ridership) ridershipHit++;
  if (land) landHit++;
  out[station.slug] = { ridership, land };
}

fs.writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(
    {
      source: {
        ridership: "国土数値情報（駅別乗降客数データ）国土交通省 / CC BY 4.0",
        land: "国土数値情報（地価公示データ）国土交通省 / CC BY 4.0",
        ridership_file: path.basename(s12Path),
        land_file: path.basename(l01Path),
      },
      stations: out,
    },
    null,
    2
  ) + "\n"
);
console.log(
  `station-public.json を書き出しました（乗降客数 ${ridershipHit}/${stations.length}駅、地価 ${landHit}/${stations.length}駅）`
);
