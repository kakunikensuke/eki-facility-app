/**
 * 駅のある市区町村の家賃水準を、総務省「住宅・土地統計調査」（2023年）から取り込み、
 * backend/data/station-rent.json に書く（2026-09-30追加）。
 *
 * なぜ要るか: 駅ページの「住宅地の地価」だけでは家賃の高さが分かりにくい（ユーザーの指摘）。
 * 駅ごとの1K相場は不動産サイトの持ち物で、無料では使えない。国の統計の市区町村別の
 * 「民営借家の延べ面積1m²当たり家賃」なら無料で全国をそろえられる。
 *
 * 使う表: 第122-4表「住宅の所有の関係(4区分)別延べ面積1平方メートル当たり家賃(10区分)別借家(専用住宅)数
 *   及び延べ面積1平方メートル当たり家賃－全国、都道府県、市区町村」（e-Stat statInfId=000040210062）
 *   の「3_民営借家」の行、「家賃0円を含まない」平均。
 *   https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040210062&fileKind=0
 * 駅 → 市区町村: 国土地理院の逆ジオコーダ（市区町村コード）。政令市は区の値を使う。
 *   逆ジオコーダが応答しないときは、地価公示（L01、--l01）の近い5地点の行政区域コードの多数決で推定する
 *   （muni_source: "gsi" / "l01"。実行時に両者の一致率を出す）。
 * 表に無いときは、政令市の区なら市全体（level: city）、人口の少ない町村なら都道府県全体の値を使い（level: prefecture）、画面にも書く。
 *
 * これは「今貸されている民営の賃貸住宅全体の平均」で、募集中の新しい物件の相場ではない。
 * 画面では必ずその旨を書く（src/stationProfileText.js の rentText）。
 *
 * 実行:
 *   node backend/scripts/importRent.js <第122-4表のxlsx> [--cache <フォルダ>] [--l01 <L01のGeoJSON>]
 * 逆ジオコーダの結果は --cache（既定: D:/ClaudeData/eki）の gsi-muni-station.json に保存する。
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-rent.json");
const UA = "kakuni-lab-eki/1.0 (https://eki.kakuni-lab.com)";
const SOURCE = "総務省「令和5年住宅・土地統計調査」第122-4表（e-Stat）";
const SURVEY_YEAR = 2023;

const args = process.argv.slice(2);
const xlsxPath = args[0];
if (!xlsxPath || xlsxPath.startsWith("--")) {
  console.error("使い方: node backend/scripts/importRent.js <第122-4表のxlsx> [--cache <フォルダ>]");
  process.exit(1);
}
const cacheIdx = args.indexOf("--cache");
const CACHE_DIR = cacheIdx === -1 ? "D:/ClaudeData/eki" : args[cacheIdx + 1];
const l01Idx = args.indexOf("--l01");
const L01_PATH = l01Idx === -1 ? "D:/ClaudeData/ksj/L01/L01-26_GML/L01-26.geojson" : args[l01Idx + 1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- xlsx（zip＋XML）を標準ライブラリだけで読む ------------------------------------

function unzip(buf) {
  // 中央ディレクトリの終わり（EOCD）を後ろから探す
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("zipとして読めません");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function readSheetRows(xlsx) {
  const files = unzip(fs.readFileSync(xlsx));
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(unescapeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  }
  const sheet = files.get("xl/worksheets/sheet1.xml").toString("utf8");
  const colIndex = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const row of sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells = [];
    for (const c of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner = ""] = c;
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (/t="s"/.test(attrs) && v !== undefined) val = shared[Number(v)];
      else if (/t="inlineStr"/.test(attrs)) val = unescapeXml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
      else if (v !== undefined) val = unescapeXml(v);
      cells[colIndex(ref)] = val;
    }
    rows.push(cells);
  }
  return rows;
}

// --- 表から「民営借家」の1m²当たり家賃（0円を含まない）を市区町村コードごとに取る ------------

function rentByCode(rows) {
  const out = new Map();
  for (const r of rows) {
    const area = r[1] ?? "";
    const owner = r[2] ?? "";
    const m = area.match(/^(\d{5})_(.+)$/);
    if (!m || !owner.startsWith("3_")) continue;
    // 最後の列が「家賃0円を含まない」平均。「-」「…」は値なし
    const value = Number(r[r.length - 1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.set(m[1], { name: m[2].replace(/\s+/g, " ").trim(), yen_per_m2: value });
  }
  return out;
}

// --- 駅 → 市区町村コード（国土地理院の逆ジオコーダ） --------------------------------------

// 逆ジオコーダが応答しないときは、それ以降は問い合わせず地価公示の地点から推定する
let gsiDown = false;
async function gsiMuniCode(lat, lon, cache) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (!(key in cache) && !gsiDown) {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
      if (res.ok) cache[key] = (await res.json()).results?.muniCd?.trim() ?? null;
      else gsiDown = true;
    } catch {
      gsiDown = true;
    }
    if (gsiDown) console.log("逆ジオコーダが応答しないので、残りは地価公示の地点から市区町村を推定します");
    await sleep(200);
  }
  return cache[key] ? cache[key].padStart(5, "0") : null;
}

// 地価公示（L01）の地点は行政区域コード（L01_001）を持つ。駅に近い5地点の多数決（近い順に重み）で市区町村を推定する
const L01_VOTES = 5;
function loadLandPoints(l01Path) {
  return JSON.parse(fs.readFileSync(l01Path, "utf-8")).features.map((f) => ({
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    code: String(f.properties.L01_001).padStart(5, "0"),
  }));
}
function landMuniCode(lat, lon, points) {
  const d2 = (p) => (p.lat - lat) ** 2 + ((p.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
  const nearest = [];
  for (const p of points) {
    const d = d2(p);
    if (nearest.length < L01_VOTES || d < nearest[nearest.length - 1].d) {
      nearest.push({ code: p.code, d });
      nearest.sort((a, b) => a.d - b.d);
      if (nearest.length > L01_VOTES) nearest.pop();
    }
  }
  const votes = new Map();
  nearest.forEach((n, i) => votes.set(n.code, (votes.get(n.code) ?? 0) + (L01_VOTES - i)));
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function main() {
  const rows = readSheetRows(xlsxPath);
  const rents = rentByCode(rows);
  const national = rents.get("00000");
  console.log(`表の市区町村など: ${rents.size}件（全国 ${national?.yen_per_m2}円/m²）`);

  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const cachePath = path.join(CACHE_DIR, "gsi-muni-station.json");
  // 駅を足したとき（addStations.js）の逆ジオコーダの結果も使う
  const addCache = path.join(CACHE_DIR, "gsi-muni.json");
  const cache = {
    ...(fs.existsSync(addCache) ? JSON.parse(fs.readFileSync(addCache, "utf-8")) : {}),
    ...(fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf-8")) : {}),
  };
  const landPoints = loadLandPoints(L01_PATH);
  const muniSources = {};
  let agree = 0;
  let compared = 0;
  const out = {};
  const levels = {};
  let n = 0;
  for (const s of stations) {
    const gsiCode = await gsiMuniCode(s.lat, s.lon, cache);
    const landCode = landMuniCode(s.lat, s.lon, landPoints);
    // 逆ジオコーダで分かった駅は、地価公示からの推定がどれだけ合うかの検算にも使う
    if (gsiCode && landCode) {
      compared++;
      if (gsiCode === landCode) agree++;
    }
    const code = gsiCode ?? landCode;
    const muniSource = gsiCode ? "gsi" : "l01";
    if (++n % 100 === 0) {
      fs.writeFileSync(cachePath, JSON.stringify(cache));
      console.log(`  ${n}/${stations.length}`);
    }
    if (!code) continue;
    const prefCode = `${code.slice(0, 2)}000`;
    // 政令市の区が表に無いとき（浜松市は2024年に区を再編し、2023年の統計の区と合わない）は市全体の値
    const cityCode = `${code.slice(0, 4)}0`;
    const hit =
      (rents.has(code) && { code, level: "municipality" }) ||
      (code[2] === "1" && cityCode !== code && rents.get(cityCode)?.name.endsWith("市") && { code: cityCode, level: "city" }) ||
      (rents.has(prefCode) && { code: prefCode, level: "prefecture" });
    if (!hit) continue;
    const r = rents.get(hit.code);
    out[s.slug] = { code: hit.code, area: r.name, level: hit.level, yen_per_m2: r.yen_per_m2, muni_source: muniSource };
    muniSources[muniSource] = (muniSources[muniSource] ?? 0) + 1;
    levels[hit.level] = (levels[hit.level] ?? 0) + 1;
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache));

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        source: SOURCE,
        survey_year: SURVEY_YEAR,
        national_yen_per_m2: national?.yen_per_m2 ?? null,
        stations: out,
      },
      null,
      1
    ) + "\n"
  );
  console.log(`station-rent.json を書き出しました（${Object.keys(out).length}/${stations.length}駅、${JSON.stringify(levels)}、市区町村の決め方 ${JSON.stringify(muniSources)}）`);
  console.log(`地価公示からの推定と逆ジオコーダの一致: ${agree}/${compared}（${((agree / compared) * 100).toFixed(1)}%）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
