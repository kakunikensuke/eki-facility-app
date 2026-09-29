/**
 * 駅の周りの災害リスク（ハザードマップの想定）を調べ、backend/data/station-hazard.json に書き出す
 * （2026-09-29追加）。
 *
 * 出どころ: ハザードマップポータルサイト（国土交通省）のオープンデータ。「重ねるハザードマップ」と
 * 同じ地図タイル（PNG）の色を読み、駅の地点と、駅から半径800m（徒歩10分）の範囲を50m間隔で調べる。
 * - 洪水浸水想定区域（想定最大規模）: 01_flood_l2_shinsuishin_data
 * - 高潮浸水想定区域: 03_hightide_l2_shinsuishin_data
 * - 津波浸水想定: 04_tsunami_newlegend_data
 * - 土砂災害警戒区域（土石流・急傾斜地の崩壊・地すべり）: 05_*keikaikuiki
 *
 * 利用条件: 商用可。「『ハザードマップポータルサイト』を加工して作成」と出典を書く。国が作った
 * 情報であるかのように見せない。宅建業の重要事項説明には使えない（画面に注意書きを出す）。
 *
 * 注意: 洪水は国・都道府県が指定した河川のものだけで、下水があふれる内水氾濫は含まない。
 * 区域外でも安全という意味ではないので、画面では必ず自治体のハザードマップへ誘導する。
 *
 * 実行: node backend/scripts/fetchHazard.js [--only slug1,slug2] [--missing] [--cache <フォルダ>]
 * タイルは --cache のフォルダ（既定: OSの一時フォルダ）に保存し、2回目以降は読み直さない。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-hazard.json");
const TILE_BASE = "https://disaportaldata.gsi.go.jp/raster";
const UA = "kakuni-lab-eki/1.0 (https://eki.kakuni-lab.com)";

const ZOOM = 15; // 1ピクセル約4m。50m間隔の点を読むには十分
const RADIUS_M = 800; // 徒歩10分（サイトの既定の段階と同じ）
const STEP_M = 50;
const CONCURRENCY = 4;

// 浸水の深さの色（国の「水害ハザードマップ作成の手引き」の凡例）。
// データによって区切りが細かい版（0.3m・1m）と粗い版があるので、画面に出す4区分にまとめる
const DEPTH_BANDS = [
  { key: "lt05", label: "0.5m未満", colors: ["255,255,179", "247,245,169"] },
  { key: "05to3", label: "0.5〜3m", colors: ["248,225,166", "255,216,192"] },
  { key: "3to5", label: "3〜5m", colors: ["255,183,183"] },
  { key: "gte5", label: "5m以上", colors: ["255,145,145", "242,133,201", "220,122,220"] },
];
const DEPTH_BY_COLOR = new Map(DEPTH_BANDS.flatMap((b, i) => b.colors.map((c) => [c, i])));

const WATER_LAYERS = {
  flood: "01_flood_l2_shinsuishin_data",
  hightide: "03_hightide_l2_shinsuishin_data",
  tsunami: "04_tsunami_newlegend_data",
};
const LANDSLIDE_LAYERS = ["05_dosekiryukeikaikuiki", "05_kyukeishakeikaikuiki", "05_jisuberikeikaikuiki"];

// --- PNG（標準ライブラリだけで読む。8bit・インターレース無しのRGBA/RGB/パレットに対応） ---------
function decodePng(buf) {
  let pos = 8;
  let w, h, bitDepth, colorType, pal, trns;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12]) throw new Error("インターレースPNGには未対応");
    } else if (type === "PLTE") pal = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`ビット深度${bitDepth}には未対応`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const rgba = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (colorType === 6) line.copy(rgba, o, x * 4, x * 4 + 4);
      else if (colorType === 2) {
        rgba[o] = line[x * 3];
        rgba[o + 1] = line[x * 3 + 1];
        rgba[o + 2] = line[x * 3 + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 3) {
        const k = line[x];
        rgba[o] = pal[k * 3];
        rgba[o + 1] = pal[k * 3 + 1];
        rgba[o + 2] = pal[k * 3 + 2];
        rgba[o + 3] = trns && k < trns.length ? trns[k] : 255;
      } else if (colorType === 0) {
        rgba.fill(line[x], o, o + 3);
        rgba[o + 3] = 255;
      } else {
        rgba.fill(line[x * 2], o, o + 3);
        rgba[o + 3] = line[x * 2 + 1];
      }
    }
    prev = line;
  }
  return { w, h, rgba };
}

// --- タイル -----------------------------------------------------------------
const cacheIdx = process.argv.indexOf("--cache");
const CACHE_DIR = cacheIdx === -1 ? path.join(os.tmpdir(), "eki-hazard-tiles") : process.argv[cacheIdx + 1];

// 同じタイルを複数の駅が使うので、読み込み中のものも含めて使い回す
const tileMemo = new Map();
function getTile(layer, x, y) {
  const key = `${layer}/${ZOOM}/${x}/${y}`;
  if (!tileMemo.has(key)) tileMemo.set(key, loadTile(key));
  return tileMemo.get(key);
}

async function loadTile(key) {
  const file = path.join(CACHE_DIR, key.replace(/\//g, "_") + ".bin");
  let buf;
  if (fs.existsSync(file)) {
    buf = fs.readFileSync(file);
  } else {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${TILE_BASE}/${key}.png`, { headers: { "User-Agent": UA } });
      // データの無い場所は404が返る（＝その範囲に区域が無い）
      if (res.status === 404) {
        buf = Buffer.alloc(0);
        break;
      }
      if (res.ok) {
        buf = Buffer.from(await res.arrayBuffer());
        break;
      }
      if (attempt >= 3) throw new Error(`${res.status} ${key}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, buf);
  }
  return buf.length === 0 ? null : decodePng(buf);
}

function toPixel(lat, lon) {
  const n = 2 ** ZOOM * 256;
  const px = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { px: Math.floor(px), py: Math.floor(py) };
}

async function colorAt(layer, lat, lon) {
  const { px, py } = toPixel(lat, lon);
  const tile = await getTile(layer, Math.floor(px / 256), Math.floor(py / 256));
  if (!tile) return null;
  const o = ((py % 256) * 256 + (px % 256)) * 4;
  // 区域の境目はぼかしで半透明になっている。半分以上透けている点は数えない
  if (tile.rgba[o + 3] < 128) return null;
  return [tile.rgba[o], tile.rgba[o + 1], tile.rgba[o + 2]];
}

function depthBand(rgb) {
  if (!rgb) return -1;
  const exact = DEPTH_BY_COLOR.get(rgb.join(","));
  if (exact !== undefined) return exact;
  // 凡例に無い色（境目の中間色）は、いちばん近い凡例の色にする
  let best = -1;
  let bestD = Infinity;
  for (const [c, i] of DEPTH_BY_COLOR) {
    const [r, g, b] = c.split(",").map(Number);
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD < 40 ** 2 ? best : -1;
}

// 土砂災害は「特別警戒区域（赤系）」と「警戒区域（黄系）」の2種類
function landslideLevel(rgb) {
  if (!rgb) return 0;
  return rgb[0] > 140 && rgb[1] < 110 ? 2 : 1;
}

// 駅を中心に半径800m・50m間隔の点（約800点）
function samplePoints(station) {
  const points = [];
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((station.lat * Math.PI) / 180);
  for (let dy = -RADIUS_M; dy <= RADIUS_M; dy += STEP_M) {
    for (let dx = -RADIUS_M; dx <= RADIUS_M; dx += STEP_M) {
      if (dx * dx + dy * dy > RADIUS_M * RADIUS_M) continue;
      points.push({ lat: station.lat + dy / mPerDegLat, lon: station.lon + dx / mPerDegLon });
    }
  }
  return points;
}

const pct = (n, total) => Math.round((n / total) * 1000) / 10;

async function hazardOf(station) {
  const points = samplePoints(station);
  const result = { radius_m: RADIUS_M };

  for (const [key, layer] of Object.entries(WATER_LAYERS)) {
    const bands = [];
    for (const p of points) bands.push(depthBand(await colorAt(layer, p.lat, p.lon)));
    const inArea = bands.filter((b) => b >= 0);
    const at = depthBand(await colorAt(layer, station.lat, station.lon));
    result[key] = {
      at_station: at >= 0 ? DEPTH_BANDS[at].key : null,
      share_pct: pct(inArea.length, points.length),
      // 3m以上（2階の床まで浸かる目安）の割合
      deep_share_pct: pct(inArea.filter((b) => b >= 2).length, points.length),
      max: inArea.length > 0 ? DEPTH_BANDS[Math.max(...inArea)].key : null,
    };
  }

  const levels = points.map(() => 0);
  let atStation = 0;
  for (const layer of LANDSLIDE_LAYERS) {
    for (let i = 0; i < points.length; i++) {
      levels[i] = Math.max(levels[i], landslideLevel(await colorAt(layer, points[i].lat, points[i].lon)));
    }
    atStation = Math.max(atStation, landslideLevel(await colorAt(layer, station.lat, station.lon)));
  }
  result.landslide = {
    at_station: atStation === 2 ? "special" : atStation === 1 ? "warning" : null,
    share_pct: pct(levels.filter((l) => l > 0).length, points.length),
    special_share_pct: pct(levels.filter((l) => l === 2).length, points.length),
  };
  return result;
}

async function main() {
  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1].split(",");
  const existing = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")).stations : {};
  const out = { ...existing };
  // --missing: まだ調べていない駅だけ。50駅ごとに書き出すので、止まっても同じコマンドで続きから再開できる
  const missing = process.argv.includes("--missing");
  const targets = stations.filter((s) => (!only || only.includes(s.slug)) && (!missing || !existing[s.slug]));
  console.log(`${targets.length}駅を調べます`);
  const today = new Date().toISOString().slice(0, 10);
  const save = () =>
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          source: "ハザードマップポータルサイト（国土交通省）のオープンデータを加工して作成",
          source_url: "https://disaportal.gsi.go.jp/",
          fetched_at: today,
          radius_m: RADIUS_M,
          depth_bands: DEPTH_BANDS.map(({ key, label }) => ({ key, label })),
          stations: Object.fromEntries(stations.filter((s) => out[s.slug]).map((s) => [s.slug, out[s.slug]])),
        },
        null,
        2
      ) + "\n"
    );

  let done = 0;
  const queue = [...targets];
  async function worker() {
    while (queue.length > 0) {
      const station = queue.shift();
      try {
        out[station.slug] = await hazardOf(station);
      } catch (err) {
        console.error(`[${station.slug}] 失敗（既存データを保持）: ${err.message}`);
      }
      done++;
      if (done % 20 === 0) console.log(`${done}/${targets.length}`);
      if (done % 50 === 0) save();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  save();
  console.log(`station-hazard.json を書き出しました（${Object.keys(out).length}駅）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
