/**
 * 住宅・土地統計調査の表（e-Stat の xlsx）を標準ライブラリだけで読む（2026-09-30追加）。
 * importRent.js（駅ごとの家賃の目安）と calibrateRent.js（都道府県ごとの補正倍率）、
 * importCensus.js（国勢調査・保育所等の表）が使う。
 */

const fs = require("fs");
const zlib = require("zlib");

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

// sheetNo: 何枚目のシートか（1から）
function readSheetRows(xlsx, sheetNo = 1) {
  const files = unzip(fs.readFileSync(xlsx));
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    // 読み仮名（ルビ、<rPh>）は文字列に含めない
    shared.push(unescapeXml([...si.replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  }
  const sheet = files.get(`xl/worksheets/sheet${sheetNo}.xml`).toString("utf8");
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
    // units: 民営借家の戸数（東京都下＝東京都−特別区部のように、地域をまとめ直すときの重み）
    out.set(m[1], { name: m[2].replace(/\s+/g, " ").trim(), yen_per_m2: value, units: Number(r[3]) || 0 });
  }
  return out;
}

// --- 政令市の区 → 市全体のコード ----------------------------------------------------------
// 政令市のコードは「都道府県2桁＋1＋2桁」で末尾0（札幌市01100、川崎市14130、浜松市22130など）、区はその後ろに続く番号。
// isCity(code) は表にその市全体の行があるか（名前が「市」で終わるか）。区でなければ null
function designatedCityOf(code, isCity) {
  if (code[2] !== "1") return null;
  for (let c = Number(code); c >= Number(code.slice(0, 3) + "00"); c--) {
    const candidate = String(c).padStart(5, "0");
    if (candidate !== code && candidate.endsWith("0") && isCity(candidate)) return candidate;
  }
  return null;
}

module.exports = { readSheetRows, rentByCode, designatedCityOf };
