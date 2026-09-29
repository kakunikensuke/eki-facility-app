/**
 * 駅周辺施設数を、OpenStreetMapの配布ファイル（.osm.pbf）から手元で数える（2026-09-30追加）。
 *
 * なぜ要るか: 掲載駅を343駅から1,856駅に増やしたとき、公開のOverpass APIが504を返し続け
 * （mail.ruのミラー・overpass-api.de・kumi.systems とも）、駅ごとの取得では15時間以上かかる見込みだった。
 * Geofabrik が配っている日本全体のファイル（約2.5GB、毎日更新）を落として読めば、
 * 全駅を同じ日のデータで数え直せる。追加のパッケージは使わず、PBF（protobuf＋zlib）を標準ライブラリで読む。
 *
 * 数え方は updateFacilityCounts.js と同じ:
 * - 対象は CATEGORY_TAGS のタグを持つ点（node）と線（way）。関係（relation）は数えない（Overpassの問い合わせと同じ）
 * - 線は外枠の中心（Overpass の out center と同じ定義）で距離を測る
 * - 4段階の距離と件数は countByTier をそのまま使う
 *
 * 実行:
 *   node backend/batch/countFacilitiesFromPbf.js <japan-latest.osm.pbf> --out <file> [--only slug1,slug2]
 * 読み取った施設は <pbfと同じフォルダ>/eki-elements-<pbfの名前>.json に保存し、2回目からはPBFを読まない。
 * 結果は --out に書くので、確かめてから scripts/mergeFacilityCounts.js で本体にまとめる。
 * データの入手先: https://download.geofabrik.de/asia/japan.html（ODbL。出典表示は今までと同じ）
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { countByTier, CATEGORY_TAGS } = require("./updateFacilityCounts");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const WALK_SPEED_M_PER_MIN = 80;
const MAX_RADIUS_M = 20 * WALK_SPEED_M_PER_MIN;
// 駅から離れた施設は持たない（メモリと計算を減らす）。線は中心で判定するので余裕を持たせる
const KEEP_RADIUS_M = MAX_RADIUS_M + 300;
const GRID_DEG = 0.02;

// --- protobuf の読み取り -------------------------------------------------------------
// 64ビットの値（ノードID・座標の差分）は Number で扱う。OSMのIDは2^53より十分小さい
class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  varint() {
    const buf = this.buf;
    let b = buf[this.pos++];
    let result = b & 0x7f;
    if (b < 0x80) return result;
    let shift = 7;
    while (true) {
      b = buf[this.pos++];
      if (shift < 28) result |= (b & 0x7f) << shift;
      else result += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return result;
      shift += 7;
    }
  }
  svarint() {
    const n = this.varint();
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  }
  bytes() {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    return [start, this.pos];
  }
  skip(wireType) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) {
      // this.pos += this.varint() と書くと、varint() が進めた位置を古い this.pos で上書きしてしまう
      const len = this.varint();
      this.pos += len;
    }
    else if (wireType === 5) this.pos += 4;
    else throw new Error(`未対応のwire type ${wireType}`);
  }
}

function packedVarints(buf, [start, end], signed) {
  const r = new Reader(buf, start, end);
  const out = [];
  while (r.pos < end) out.push(signed ? r.svarint() : r.varint());
  return out;
}

// 対象のタグ（キー → 値の集合）
const WANTED = new Map();
for (const tags of Object.values(CATEGORY_TAGS)) {
  for (const [key, value] of tags) {
    if (!WANTED.has(key)) WANTED.set(key, new Set());
    WANTED.get(key).add(value);
  }
}

// ファイルを Blob ごとに読み、OSMData の PrimitiveBlock を渡す
function* primitiveBlocks(file) {
  const fd = fs.openSync(file, "r");
  const lenBuf = Buffer.alloc(4);
  let offset = 0;
  try {
    while (fs.readSync(fd, lenBuf, 0, 4, offset) === 4) {
      offset += 4;
      const headerLen = lenBuf.readUInt32BE(0);
      const header = Buffer.alloc(headerLen);
      fs.readSync(fd, header, 0, headerLen, offset);
      offset += headerLen;
      let type = "";
      let dataSize = 0;
      const hr = new Reader(header);
      while (hr.pos < hr.end) {
        const key = hr.varint();
        const field = key >>> 3;
        if (field === 1) {
          const [s, e] = hr.bytes();
          type = header.toString("utf8", s, e);
        } else if (field === 3) dataSize = hr.varint();
        else hr.skip(key & 7);
      }
      const blob = Buffer.alloc(dataSize);
      fs.readSync(fd, blob, 0, dataSize, offset);
      offset += dataSize;
      if (type !== "OSMData") continue;
      const br = new Reader(blob);
      let data = null;
      while (br.pos < br.end) {
        const key = br.varint();
        const field = key >>> 3;
        if (field === 1) {
          const [s, e] = br.bytes();
          data = blob.subarray(s, e);
        } else if (field === 3) {
          const [s, e] = br.bytes();
          data = zlib.inflateSync(blob.subarray(s, e));
        } else br.skip(key & 7);
      }
      if (data) yield data;
    }
  } finally {
    fs.closeSync(fd);
  }
}

// PrimitiveBlock を読み、点・線を callback に渡す。
// want: { denseAll } — true のときタグの無い点も座標を渡す（2回目の読み取り用）
function readBlock(buf, handlers) {
  const r = new Reader(buf);
  let strings = [];
  const groups = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  while (r.pos < r.end) {
    const key = r.varint();
    const field = key >>> 3;
    if (field === 1) {
      const [s, e] = r.bytes();
      const sr = new Reader(buf, s, e);
      while (sr.pos < e) {
        const k = sr.varint();
        if (k >>> 3 === 1) {
          const [a, b] = sr.bytes();
          strings.push(buf.toString("utf8", a, b));
        } else sr.skip(k & 7);
      }
    } else if (field === 2) groups.push(r.bytes());
    else if (field === 17) granularity = r.varint();
    else if (field === 19) latOffset = r.varint();
    else if (field === 20) lonOffset = r.varint();
    else r.skip(key & 7);
  }
  const toDeg = (v, off) => (off + granularity * v) * 1e-9;

  // このブロックの文字列表のうち、対象のキー・値に当たる番号
  const keyIdx = new Map();
  const valIdx = new Set();
  const allValues = new Set([...WANTED.values()].flatMap((s) => [...s]));
  strings.forEach((str, i) => {
    if (WANTED.has(str)) keyIdx.set(i, str);
    if (allValues.has(str)) valIdx.add(i);
  });
  const tagsOf = (keys, vals) => {
    let tags = null;
    for (let i = 0; i < keys.length; i++) {
      const k = keyIdx.get(keys[i]);
      if (k && valIdx.has(vals[i]) && WANTED.get(k).has(strings[vals[i]])) {
        (tags ??= {})[k] = strings[vals[i]];
      }
    }
    return tags;
  };

  for (const range of groups) {
    const g = new Reader(buf, range[0], range[1]);
    while (g.pos < g.end) {
      const key = g.varint();
      const field = key >>> 3;
      if (field === 2 && (handlers.node || handlers.coord)) {
        // DenseNodes
        const [s, e] = g.bytes();
        const d = new Reader(buf, s, e);
        let ids = null;
        let lats = null;
        let lons = null;
        let kv = null;
        while (d.pos < e) {
          const k = d.varint();
          const f = k >>> 3;
          if (f === 1) ids = packedVarints(buf, d.bytes(), true);
          else if (f === 8) lats = packedVarints(buf, d.bytes(), true);
          else if (f === 9) lons = packedVarints(buf, d.bytes(), true);
          else if (f === 10 && handlers.node) kv = packedVarints(buf, d.bytes(), false);
          else d.skip(k & 7);
        }
        let id = 0;
        let lat = 0;
        let lon = 0;
        let kvPos = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i];
          lat += lats[i];
          lon += lons[i];
          if (handlers.coord) handlers.coord(id, toDeg(lat, latOffset), toDeg(lon, lonOffset));
          if (kv) {
            let keys = null;
            let vals = null;
            while (kvPos < kv.length && kv[kvPos] !== 0) {
              (keys ??= []).push(kv[kvPos]);
              (vals ??= []).push(kv[kvPos + 1]);
              kvPos += 2;
            }
            kvPos++;
            if (keys) {
              const tags = tagsOf(keys, vals);
              if (tags) handlers.node(id, toDeg(lat, latOffset), toDeg(lon, lonOffset), tags);
            }
          }
        }
      } else if (field === 1 && handlers.node) {
        // 旧形式の Node（日本のファイルではほぼ使われていないが、念のため読む）
        const [s, e] = g.bytes();
        const n = new Reader(buf, s, e);
        let id = 0;
        let lat = 0;
        let lon = 0;
        let keys = [];
        let vals = [];
        while (n.pos < e) {
          const k = n.varint();
          const f = k >>> 3;
          if (f === 1) id = n.svarint();
          else if (f === 2) keys = packedVarints(buf, n.bytes(), false);
          else if (f === 3) vals = packedVarints(buf, n.bytes(), false);
          else if (f === 8) lat = n.svarint();
          else if (f === 9) lon = n.svarint();
          else n.skip(k & 7);
        }
        const tags = tagsOf(keys, vals);
        if (tags) handlers.node(id, toDeg(lat, latOffset), toDeg(lon, lonOffset), tags);
      } else if (field === 3 && handlers.way) {
        const [s, e] = g.bytes();
        const w = new Reader(buf, s, e);
        let id = 0;
        let keys = [];
        let vals = [];
        let refsRange = null;
        while (w.pos < e) {
          const k = w.varint();
          const f = k >>> 3;
          if (f === 1) id = w.varint();
          else if (f === 2) keys = packedVarints(buf, w.bytes(), false);
          else if (f === 3) vals = packedVarints(buf, w.bytes(), false);
          else if (f === 8) refsRange = w.bytes();
          else w.skip(k & 7);
        }
        const tags = tagsOf(keys, vals);
        if (tags && refsRange) {
          const deltas = packedVarints(buf, refsRange, true);
          const refs = new Array(deltas.length);
          let ref = 0;
          for (let i = 0; i < deltas.length; i++) refs[i] = ref += deltas[i];
          handlers.way(id, refs, tags);
        }
      } else g.skip(key & 7);
    }
  }
}

// --- 駅の近くかどうか ---------------------------------------------------------------
function buildStationGrid(stations) {
  const grid = new Map();
  for (const s of stations) {
    const key = `${Math.floor(s.lat / GRID_DEG)},${Math.floor(s.lon / GRID_DEG)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(s);
  }
  return grid;
}

function distanceM(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function nearAnyStation(grid, lat, lon) {
  const gy = Math.floor(lat / GRID_DEG);
  const gx = Math.floor(lon / GRID_DEG);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (const s of grid.get(`${gy + dy},${gx + dx}`) ?? []) {
        if (distanceM(lat, lon, s.lat, s.lon) <= KEEP_RADIUS_M) return true;
      }
    }
  }
  return false;
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

// --- 本体 ---------------------------------------------------------------------------
function extractElements(pbf, stations) {
  const grid = buildStationGrid(stations);
  const elements = [];
  const ways = [];
  const needed = new Set();
  let blocks = 0;
  const t0 = Date.now();

  // 1回目: 対象タグの点（駅の近くのものだけ）と線（構成点の番号）を集める
  for (const block of primitiveBlocks(pbf)) {
    readBlock(block, {
      node(id, lat, lon, tags) {
        if (nearAnyStation(grid, lat, lon)) elements.push({ type: "node", id, lat, lon, tags });
      },
      way(id, refs, tags) {
        ways.push({ id, refs, tags });
        for (const r of refs) needed.add(r);
      },
    });
    if (++blocks % 2000 === 0) console.log(`  1回目: ${blocks}ブロック（${Math.round((Date.now() - t0) / 1000)}秒）`);
  }
  console.log(`1回目: 点${elements.length}件・線${ways.length}件・線の構成点${needed.size}件`);

  // 2回目: 線の構成点の座標を集め、外枠の中心を出す
  const coords = new Map();
  blocks = 0;
  for (const block of primitiveBlocks(pbf)) {
    readBlock(block, {
      coord(id, lat, lon) {
        if (needed.has(id)) coords.set(id, [lat, lon]);
      },
    });
    if (++blocks % 2000 === 0) console.log(`  2回目: ${blocks}ブロック（${Math.round((Date.now() - t0) / 1000)}秒）`);
  }
  let missingRefs = 0;
  for (const w of ways) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const r of w.refs) {
      const c = coords.get(r);
      if (!c) {
        missingRefs++;
        continue;
      }
      if (c[0] < minLat) minLat = c[0];
      if (c[0] > maxLat) maxLat = c[0];
      if (c[1] < minLon) minLon = c[1];
      if (c[1] > maxLon) maxLon = c[1];
    }
    if (minLat === Infinity) continue;
    const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
    if (nearAnyStation(grid, center.lat, center.lon)) elements.push({ type: "way", id: w.id, center, tags: w.tags });
  }
  console.log(
    `駅の近くの施設: ${elements.length}件（座標の見つからない構成点 ${missingRefs}件、${Math.round((Date.now() - t0) / 1000)}秒）`
  );
  return elements;
}

function main() {
  const args = process.argv.slice(2);
  const pbf = args[0];
  const outIdx = args.indexOf("--out");
  if (!pbf || outIdx === -1) {
    console.error("使い方: node backend/batch/countFacilitiesFromPbf.js <japan.osm.pbf> --out <file> [--only slug1,slug2]");
    process.exit(1);
  }
  const outPath = path.resolve(args[outIdx + 1]);
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx === -1 ? null : args[onlyIdx + 1].split(",");
  const allStations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const stations = only ? allStations.filter((s) => only.includes(s.slug)) : allStations;

  // 読み取った施設は全駅ぶんを保存しておき、駅を足したときも読み直さずに済むようにする
  const cachePath = path.join(path.dirname(pbf), `eki-elements-${path.basename(pbf, ".osm.pbf")}.json`);
  let elements;
  if (fs.existsSync(cachePath)) {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const covered = new Set(cache.stations);
    if (stations.every((s) => covered.has(s.slug))) elements = cache.elements;
  }
  if (!elements) {
    elements = extractElements(pbf, allStations);
    fs.writeFileSync(cachePath, JSON.stringify({ stations: allStations.map((s) => s.slug), elements }));
  }

  // 駅ごとに、近くの施設だけを countByTier に渡す
  const grid = new Map();
  for (const el of elements) {
    const p = el.type === "node" ? el : el.center;
    const key = `${Math.floor(p.lat / GRID_DEG)},${Math.floor(p.lon / GRID_DEG)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(el);
  }
  const results = {};
  const updatedAt = nowJst();
  for (const s of stations) {
    const gy = Math.floor(s.lat / GRID_DEG);
    const gx = Math.floor(s.lon / GRID_DEG);
    const near = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) near.push(...(grid.get(`${gy + dy},${gx + dx}`) ?? []));
    }
    results[s.slug] = {
      walk_speed_m_per_min: WALK_SPEED_M_PER_MIN,
      tiers: countByTier(near, s.lat, s.lon),
      updated_at: updatedAt,
      source: "OpenStreetMap contributors (ODbL)",
    };
  }
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n", "utf-8");
  console.log(`${stations.length}駅を数えました -> ${outPath}`);
}

main();
