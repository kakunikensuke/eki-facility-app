/**
 * 駅がどの路線に乗っているかを国土数値情報の駅別乗降客数データ（S12）から調べ、
 * backend/data/station-lines.json に書き出す（2026-09-29追加。路線ごとのページに使う）。
 *
 * S12は「駅×路線」の行を持ち、路線名は正式名（例: 埼京線は「赤羽線」、京浜東北線は「東北線」など）。
 * 正式名のままだと利用者の呼び方と合わないので、ページに出す名前は LINE_META で付け直す。
 * LINE_META に無い路線はページを作らない（名前を機械的に作ると呼び方が間違ったページができる）。
 *
 * 路線に載せる駅の決め方:
 * - S12の駅名と、このサイトの駅名（「東急 渋谷駅」なら「渋谷」）が一致すること
 * - 事業者名の付いた駅（「東急 渋谷駅」「Osaka Metro 梅田駅」）は、その事業者の路線にだけ載せる
 * - 同じ路線に同じ駅が2つ載る（「渋谷駅」と「東急 渋谷駅」）ときは、事業者名が合う方を残す
 * - このサイトで扱っている駅が MIN_STATIONS 駅以上ある路線だけページにする
 *
 * 実行: node backend/scripts/importLines.js <S12のGeoJSON>
 */

const fs = require("fs");
const path = require("path");

const [, , s12Path] = process.argv;
if (!s12Path) {
  console.error("使い方: node backend/scripts/importLines.js <S12のGeoJSON>");
  process.exit(1);
}

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-lines.json");
const MATCH_KM = 1.0;
const MIN_STATIONS = 5;

// 駅名に付いている事業者名 → S12の事業者名
const PREFIX_OPERATOR = {
  京王: "京王電鉄",
  京阪: "京阪電気鉄道",
  阪急: "阪急電鉄",
  阪神: "阪神電気鉄道",
  東急: "東急電鉄",
  西武: "西武鉄道",
  東武: "東武鉄道",
  小田急: "小田急電鉄",
  京急: "京浜急行電鉄",
  京成: "京成電鉄",
  南海: "南海電気鉄道",
  近鉄: "近畿日本鉄道",
  "Osaka Metro": "大阪市高速電気軌道",
  横浜市営地下鉄: "横浜市",
  札幌市営: "札幌市",
  東京モノレール: "東京モノレール",
};

// ページにする路線。key は「S12の事業者名|S12の路線名」。
// name は利用者の呼び方、note は正式名と呼び方がずれているときの説明（ページに出す）
const LINE_META = {
  "東日本旅客鉄道|山手線": { slug: "jr-yamanote", name: "JR山手線" },
  "東日本旅客鉄道|中央線": {
    slug: "jr-chuo",
    name: "JR中央線",
    note: "正式な路線名の「中央本線」でまとめています。中央線快速と、御茶ノ水〜三鷹の中央・総武線各駅停車、高尾より西の区間を含みます。",
  },
  "東日本旅客鉄道|東北線": {
    slug: "jr-tohoku",
    name: "JR東北本線（京浜東北線・宇都宮線）",
    note: "正式な路線名の「東北本線」でまとめています。東京〜大宮の京浜東北線、宇都宮線、東北地方の東北本線を含みます。",
  },
  "東日本旅客鉄道|東海道線": {
    slug: "jr-tokaido",
    name: "JR東海道本線（東海道線・京浜東北線）",
    note: "正式な路線名の「東海道本線」でまとめています。東京〜横浜の京浜東北線の区間を含みます。",
  },
  "東日本旅客鉄道|総武線": {
    slug: "jr-sobu",
    name: "JR総武本線（総武線各駅停車・快速）",
    note: "正式な路線名の「総武本線」でまとめています。",
  },
  "東日本旅客鉄道|武蔵野線": { slug: "jr-musashino", name: "JR武蔵野線" },
  "東日本旅客鉄道|常磐線": { slug: "jr-joban", name: "JR常磐線" },
  "東日本旅客鉄道|横浜線": { slug: "jr-yokohama", name: "JR横浜線" },
  "東日本旅客鉄道|南武線": { slug: "jr-nambu", name: "JR南武線" },
  "東日本旅客鉄道|京葉線": { slug: "jr-keiyo", name: "JR京葉線" },
  "東日本旅客鉄道|根岸線": { slug: "jr-negishi", name: "JR根岸線" },
  "東日本旅客鉄道|高崎線": { slug: "jr-takasaki", name: "JR高崎線" },
  "東日本旅客鉄道|青梅線": { slug: "jr-ome", name: "JR青梅線" },
  "東日本旅客鉄道|横須賀線": { slug: "jr-yokosuka", name: "JR横須賀線" },
  "東日本旅客鉄道|奥羽線": { slug: "jr-ou", name: "JR奥羽本線" },
  "大阪市高速電気軌道|1号線(御堂筋線)": { slug: "osaka-metro-midosuji", name: "Osaka Metro御堂筋線" },
  "大阪市高速電気軌道|2号線(谷町線)": { slug: "osaka-metro-tanimachi", name: "Osaka Metro谷町線" },
  "大阪市高速電気軌道|7号線(長堀鶴見緑地線)": {
    slug: "osaka-metro-nagahori-tsurumi-ryokuchi",
    name: "Osaka Metro長堀鶴見緑地線",
  },
  "大阪市高速電気軌道|6号線(堺筋線)": { slug: "osaka-metro-sakaisuji", name: "Osaka Metro堺筋線" },
  "京阪電気鉄道|京阪本線": { slug: "keihan-main", name: "京阪本線" },
  "東京地下鉄|4号線丸ノ内線": { slug: "tokyo-metro-marunouchi", name: "東京メトロ丸ノ内線" },
  "東京地下鉄|2号線日比谷線": { slug: "tokyo-metro-hibiya", name: "東京メトロ日比谷線" },
  "東京地下鉄|7号線南北線": { slug: "tokyo-metro-namboku", name: "東京メトロ南北線" },
  "東京地下鉄|3号線銀座線": { slug: "tokyo-metro-ginza", name: "東京メトロ銀座線" },
  "東京地下鉄|5号線東西線": { slug: "tokyo-metro-tozai", name: "東京メトロ東西線" },
  "東京地下鉄|8号線有楽町線": { slug: "tokyo-metro-yurakucho", name: "東京メトロ有楽町線" },
  "東急電鉄|東横線": { slug: "tokyu-toyoko", name: "東急東横線" },
  "東急電鉄|田園都市線": { slug: "tokyu-denentoshi", name: "東急田園都市線" },
  "京王電鉄|京王線": { slug: "keio", name: "京王線" },
  "東京都|12号線大江戸線": { slug: "toei-oedo", name: "都営大江戸線" },
  "東京都|10号線新宿線": { slug: "toei-shinjuku", name: "都営新宿線" },
  "横浜市|3号線": { slug: "yokohama-blue", name: "横浜市営地下鉄ブルーライン" },
  "小田急電鉄|小田原線": { slug: "odakyu-odawara", name: "小田急小田原線" },
  "東日本旅客鉄道|赤羽線": {
    slug: "jr-akabane",
    name: "JR埼京線（赤羽線）",
    note: "正式な路線名の「赤羽線」（池袋〜赤羽）でまとめています。赤羽より北の埼京線の区間は「東北本線」に入ります。",
  },
};

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const normalize = (name) => name.replace(/ヶ/g, "ケ").replace(/ヵ/g, "カ");

// このサイトの駅名とS12の駅名が違う実在の駅（S12側の表記）
const NAME_ALIASES = { 関西国際空港: "関西空港", 大阪国際空港: "大阪空港", なんば: "難波" };

// 「東急 渋谷駅」→ { prefix: "東急", names: ["渋谷"] }、「京王府中駅」→ { prefix: "京王", names: ["京王府中", "府中"] }
function parseName(nameJa) {
  const lastSpace = nameJa.lastIndexOf(" ");
  let prefix = lastSpace > 0 ? nameJa.slice(0, lastSpace) : null;
  const base = nameJa.slice(lastSpace + 1).replace(/駅$/, "");
  const names = [base];
  if (NAME_ALIASES[base]) names.push(NAME_ALIASES[base]);
  for (const p of Object.keys(PREFIX_OPERATOR)) {
    if (!prefix && base.startsWith(p) && base.length > p.length) {
      prefix = p;
      names.push(base.slice(p.length));
    }
  }
  return { prefix, names: names.map(normalize) };
}

const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
const rows = JSON.parse(fs.readFileSync(s12Path, "utf-8")).features.map((f) => {
  const p = f.properties;
  const c = f.geometry.coordinates;
  const [lon, lat] = c[Math.floor(c.length / 2)];
  return { name: normalize(p.S12_001), operator: p.S12_002, line: p.S12_003, lat, lon };
});

// 路線ごとに載る駅（重複除去の前）
const byLine = new Map();
// S12に同じ名前の駅が見つかった駅。見つからないものはロッカーアプリ由来の施設名
// （「イオンモール仙台上杉駅」など、鉄道の駅ではない掲載）で、路線ページや記事の集計から外す
const railStations = [];
const notRail = [];
for (const station of stations) {
  const { prefix, names } = parseName(station.name_ja);
  const operator = prefix ? PREFIX_OPERATOR[prefix] : null;
  const hits = rows.filter(
    (r) =>
      names.includes(r.name) &&
      (!operator || r.operator === operator) &&
      distanceKm(station, r) <= MATCH_KM
  );
  if (hits.length > 0) railStations.push(station.slug);
  else notRail.push(station.name_ja);
  for (const r of hits) {
    const key = `${r.operator}|${r.line}`;
    if (!byLine.has(key)) byLine.set(key, new Map());
    const list = byLine.get(key);
    // 同じ路線の同じ駅（S12の駅名が同じ）に2駅が当たったら、事業者名が合う方を残す
    const prev = list.get(r.name);
    if (!prev || (operator && !prev.operator)) list.set(r.name, { slug: station.slug, operator });
  }
}

const lines = [];
const skipped = [];
for (const [key, list] of byLine) {
  const slugs = [...list.values()].map((v) => v.slug);
  if (slugs.length < MIN_STATIONS) continue;
  const meta = LINE_META[key];
  if (!meta) {
    skipped.push(`${key}（${slugs.length}駅）`);
    continue;
  }
  const [operator, official] = key.split("|");
  lines.push({ slug: meta.slug, name: meta.name, operator, official, note: meta.note ?? null, stations: slugs });
}
lines.sort((a, b) => b.stations.length - a.stations.length);

const stationLines = {};
for (const line of lines) {
  for (const slug of line.stations) (stationLines[slug] ??= []).push(line.slug);
}

fs.writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(
    {
      source: "国土数値情報（駅別乗降客数データ）国土交通省 / CC BY 4.0",
      source_file: path.basename(s12Path),
      lines,
      station_lines: stationLines,
      rail_stations: railStations,
    },
    null,
    2
  ) + "\n"
);
console.log(`station-lines.json を書き出しました（${lines.length}路線、駅として確認できた駅 ${railStations.length}/${stations.length}）`);
console.log(`S12に同名の駅が無い: ${notRail.join("、")}`);
if (skipped.length > 0) console.log(`名前の定義が無いので作らなかった路線: ${skipped.join("、")}`);
