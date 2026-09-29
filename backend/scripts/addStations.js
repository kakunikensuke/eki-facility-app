/**
 * 国土数値情報S12（駅別乗降客数）から掲載する駅を選び、backend/data/stations.json に足す
 * （2026-09-30追加。343駅 → 全国の1日1万人以上の駅＋県庁所在地の駅）。
 *
 * 選び方:
 * - S12の「駅×路線」の行を駅グループ（S12_001g）でまとめ、さらに同じ名前で600m以内のものを
 *   1駅とみなして乗降客数を足す（JRと私鉄の渋谷を別々のページにしない）
 * - 1日の乗降客数が --min 以上の駅と、県庁所在地の代表駅（CAPITALS）を選ぶ
 * - すでに掲載している駅（同じ名前で600m以内、または名前が違っても200m以内）は足さない
 *
 * 読み・URL・座標: Wikidataの駅の項目（日本語版Wikipediaの記事があるもの）を名前と距離で合わせ、
 *   読みがな（P1814）と英語名から作る。合う項目が無い駅は足さずに一覧に出す
 * 都道府県: 国土地理院の逆ジオコーダ（座標 → 市区町村コード）
 *
 * 実行:
 *   node backend/scripts/addStations.js <S12のGeoJSON> [--min 10000] [--pref-min 3] [--cache <フォルダ>] [--write]
 * --pref-min を付けると、掲載駅がその数に満たない都道府県に、県内で乗降客数の多い駅を足して数をそろえる
 * （2026-09-30追加。1〜2駅の県には都道府県ページを作らないため。既存駅から800m以内の駅は同じ場所なので選ばない）。
 * --write を付けないときは stations.json を書き換えず、足す予定の駅を <cache>/station-candidates.json に出す。
 * Wikidataと逆ジオコーダの結果は --cache（既定: D:/ClaudeData/eki）に保存し、2回目以降は読み直さない。
 *
 * 足したあとは、施設数（batch/updateFacilityCounts.js）・写真・災害リスク・地価/乗降客数・路線の
 * 各スクリプトを新しい駅について実行する（CLAUDE.md の「駅を足すとき」）。
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const s12Path = args[0];
if (!s12Path || s12Path.startsWith("--")) {
  console.error("使い方: node backend/scripts/addStations.js <S12のGeoJSON> [--min 10000] [--pref-min 3] [--cache <フォルダ>] [--write]");
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const MIN_DAILY = Number(opt("--min", 10000));
const CACHE_DIR = opt("--cache", "D:/ClaudeData/eki");
const WRITE = args.includes("--write");
const PREF_MIN = Number(opt("--pref-min", 0));

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const UA = "kakuni-lab-eki/1.0 (https://eki.kakuni-lab.com)";

// 同じ駅とみなす距離
const SAME_NAME_KM = 0.6;
const SAME_PLACE_KM = 0.2;
// Wikidataの項目と合わせる距離（S12の座標はホームの線の端なので、駅舎の点とは数百mずれる）
const WIKIDATA_MATCH_KM = 0.8;
// --pref-min で足す駅は、既存の駅やほかに足す駅からこれ以上離れたものに限る（徒歩10分圏がほぼ重なる駅は中身も同じになる）
const PREF_MIN_APART_KM = 0.8;
// --pref-min で候補を探す範囲（県庁所在地の駅からの距離）と、1県あたり逆ジオコーダに問い合わせる上限
const PREF_MIN_RADIUS_KM = 150;
const PREF_MIN_LOOKUPS = 400;

// 県庁所在地の代表駅。乗降客数が少なくても全都道府県を載せるために入れる。
// 同じ名前の駅が他県にもある（福島・山口など）ので、おおよその位置で選ぶ
const CAPITALS = [
  ["札幌", 43.068, 141.351], ["青森", 40.829, 140.734], ["盛岡", 39.701, 141.137],
  ["仙台", 38.260, 140.882], ["秋田", 39.717, 140.129], ["山形", 38.248, 140.328],
  ["福島", 37.754, 140.459], ["水戸", 36.371, 140.476], ["宇都宮", 36.559, 139.898],
  ["前橋", 36.383, 139.073], ["浦和", 35.859, 139.657], ["千葉", 35.613, 140.113],
  ["東京", 35.681, 139.767], ["横浜", 35.466, 139.622], ["新潟", 37.912, 139.061],
  ["富山", 36.701, 137.213], ["金沢", 36.578, 136.648], ["福井", 36.062, 136.223],
  ["甲府", 35.667, 138.569], ["長野", 36.643, 138.189], ["岐阜", 35.410, 136.757],
  ["静岡", 34.972, 138.389], ["名古屋", 35.171, 136.882], ["津", 34.734, 136.511],
  ["大津", 35.003, 135.865], ["京都", 34.986, 135.759], ["大阪", 34.702, 135.496],
  ["三ノ宮", 34.695, 135.195], ["奈良", 34.681, 135.820], ["和歌山", 34.232, 135.191],
  ["鳥取", 35.494, 134.226], ["松江", 35.465, 133.063], ["岡山", 34.666, 133.918],
  ["広島", 34.398, 132.476], ["山口", 34.171, 131.477], ["徳島", 34.074, 134.551],
  ["高松", 34.351, 134.047], ["松山", 33.837, 132.751], ["高知", 33.567, 133.544],
  ["博多", 33.590, 130.421], ["佐賀", 33.264, 130.297], ["長崎", 32.752, 129.870],
  ["熊本", 32.790, 130.689], ["大分", 33.233, 131.607], ["宮崎", 31.916, 131.432],
  ["鹿児島中央", 31.584, 130.542], ["県庁前", 26.215, 127.679],
];

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
// URLが重なったときの区別に使う（fuchu-hiroshima など）
const PREF_ROMAJI = [
  "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "ibaraki", "tochigi", "gunma",
  "saitama", "chiba", "tokyo", "kanagawa", "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano",
  "gifu", "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama",
  "tottori", "shimane", "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi", "fukuoka",
  "saga", "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
];

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 名前の比べ方: 「駅」・括弧書き・中黒をとり、ヶ/ケなどの揺れをそろえる
function normalize(name) {
  return name
    .normalize("NFKC")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[・･\s]/g, "")
    .replace(/(駅|停留場)$/, "")
    .replace(/ヶ/g, "ケ")
    .replace(/ヵ/g, "カ")
    .replace(/祗/g, "祇");
}

// 既存の掲載名「東急 渋谷駅」「京王府中駅」「Osaka Metro 江坂駅」→ 比べる名前の候補
const OPERATOR_PREFIXES = ["京王", "京阪", "阪急", "阪神", "東急", "西武", "東武", "小田急", "京急", "京成", "南海", "近鉄"];
// 既存の掲載名とS12の表記が違う実在の駅（importLines.js の NAME_ALIASES と同じ）。
// 2026-09-30、「関西国際空港駅」の座標がS12と767mずれていて「関西空港駅」を重ねて足してしまった
const NAME_ALIASES = { 関西国際空港: "関西空港", 大阪国際空港: "大阪空港", なんば: "難波" };

function existingNames(nameJa) {
  const base = normalize(nameJa.replace(/（[^）]*）$/, "").replace(/^.*\s/, ""));
  const names = [base];
  if (NAME_ALIASES[base]) names.push(NAME_ALIASES[base]);
  for (const prefix of OPERATOR_PREFIXES) {
    if (base.startsWith(prefix) && base.length > prefix.length) names.push(base.slice(prefix.length));
  }
  return names;
}

async function cached(file, produce) {
  const full = path.join(CACHE_DIR, file);
  if (fs.existsSync(full)) return JSON.parse(fs.readFileSync(full, "utf-8"));
  const value = await produce();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value));
  return value;
}

// --- S12から駅をまとめる --------------------------------------------------------
function loadS12Stations() {
  const features = JSON.parse(fs.readFileSync(s12Path, "utf-8")).features;
  const groups = new Map();
  for (const f of features) {
    const p = f.properties;
    const coords = f.geometry.coordinates;
    const [lon, lat] = coords[Math.floor(coords.length / 2)];
    if (!groups.has(p.S12_001g)) groups.set(p.S12_001g, { name: p.S12_001, lat, lon, total: 0, lines: new Set() });
    const g = groups.get(p.S12_001g);
    g.lines.add(p.S12_003);
    // 最新年度のデータ有無（S12_058=1）と乗降客数（S12_061）。importPublicData.js と同じ読み方
    if (p.S12_058 === 1 && p.S12_061 > 0) g.total += p.S12_061;
  }
  const merged = [];
  for (const g of [...groups.values()].sort((a, b) => b.total - a.total)) {
    const key = normalize(g.name);
    const same = merged.find((m) => m.key === key && distanceKm(m, g) <= SAME_NAME_KM);
    if (same) {
      same.total += g.total;
      g.lines.forEach((l) => same.lines.add(l));
    } else {
      merged.push({ key, name: g.name, lat: g.lat, lon: g.lon, total: g.total, lines: new Set(g.lines) });
    }
  }
  return merged;
}

// --- Wikidata --------------------------------------------------------------------
async function loadWikidata() {
  const rows = await sparqlRows("wikidata-jp-stations.json", "Q55488");
  // 路面電車の停留場（2026-09-30追加）。Wikidataでは駅と別の分類
  const tramRows = await sparqlRows("wikidata-jp-tramstops.json", "Q2175765");
  rows.results.bindings.push(...tramRows.results.bindings);
  return itemsFromRows(rows);
}

async function sparqlRows(file, klass) {
  return cached(file, async () => {
    const query = `SELECT ?item ?ja ?en ?kana ?loc ?article WHERE {
      ?item wdt:P31/wdt:P279* wd:${klass} ; wdt:P17 wd:Q17 ; wdt:P625 ?loc .
      OPTIONAL { ?item rdfs:label ?ja FILTER(LANG(?ja)="ja") }
      OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en)="en") }
      OPTIONAL { ?item wdt:P1814 ?kana }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> }
    }`;
    const res = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query), {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) throw new Error(`Wikidata ${res.status}`);
    return res.json();
  });
}

function itemsFromRows(rows) {
  const items = new Map();
  for (const b of rows.results.bindings) {
    const id = b.item.value.split("/").pop();
    const m = b.loc.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    if (!m || !b.ja || !b.article) continue;
    if (!items.has(id)) {
      items.set(id, {
        id,
        ja: b.ja.value,
        key: normalize(b.ja.value.replace(WIKIDATA_LABEL_PREFIX, "")),
        en: b.en?.value ?? null,
        kana: b.kana?.value ?? null,
        lon: Number(m[1]),
        lat: Number(m[2]),
        article: decodeURIComponent(b.article.value.split("/wiki/")[1]).replace(/_/g, " "),
      });
    }
  }
  return [...items.values()];
}

// Wikidataのラベルに事業者名が付いている駅（「阪急電鉄西院駅」）
const WIKIDATA_LABEL_PREFIX = /^阪急電鉄/;
// 名前か座標が合わず自動では見つからない駅の項目（S12の駅名 → Wikidataの項目）。
// s12Coords: Wikidataの座標がずれている（立花駅は神戸市内、大野城駅は約1km西を指している）ので、S12の座標を使う
const WIKIDATA_OVERRIDES = {
  立花: { id: "Q1038095", s12Coords: true },
  大野城: { id: "Q5359644", s12Coords: true },
};

function matchWikidata(station, items) {
  const override = WIKIDATA_OVERRIDES[station.name];
  if (override) {
    const w = items.find((x) => x.id === override.id);
    return w && override.s12Coords ? { ...w, lat: station.lat, lon: station.lon } : w ?? null;
  }
  return (
    items
      .filter((w) => w.key === station.key)
      .map((w) => ({ w, km: distanceKm(station, w) }))
      .filter((c) => c.km <= WIKIDATA_MATCH_KM)
      // 読みがなのある項目を優先する（同じ駅に事業者ごとの項目があり、片方にしか無いことが多い）
      .sort((a, b) => (b.w.kana ? 1 : 0) - (a.w.kana ? 1 : 0) || a.km - b.km)[0]?.w ?? null
  );
}

// --- 都道府県（国土地理院の逆ジオコーダ） ----------------------------------------
async function prefectureOf(lat, lon, cache) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (!(key in cache)) {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;
    for (let i = 0; ; i++) {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const json = await res.json();
        cache[key] = json.results?.muniCd?.trim() ?? null;
        break;
      }
      if (i >= 3) throw new Error(`逆ジオコーダ ${res.status}`);
      await sleep(3000 * (i + 1));
    }
    await sleep(200);
  }
  const code = cache[key];
  return code ? Number(code.padStart(5, "0").slice(0, 2)) - 1 : null;
}

// --- URLと読み ---------------------------------------------------------------------
function slugFromEnglish(en) {
  return en
    .replace(/\s*\(.*?\)\s*/g, " ")
    .trim()
    .replace(/\s+Station$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Wikidataの読みは「いけぶくろえき」のように「えき」まで入っている
function kanaOf(w) {
  const raw = w.kana ?? w.wikipediaKana;
  if (!raw) return null;
  // 「虎ノ門ヒルズ」「JR難波」など、記事の読みにカタカナが混ざるものはひらがなにそろえる
  const kana = raw
    .replace(/[\s・]/g, "")
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/(えき|ていりゅうじょう)$/, "");
  return /^[\u3041-\u309fー]+$/.test(kana) ? kana : null;
}

/**
 * Wikidataに読みがな（P1814）が無い駅は、日本語版Wikipediaの記事の書き出し
 * 「名鉄名古屋駅（めいてつなごやえき）は、…」の括弧の中から読みを取る
 */
async function fillKanaFromWikipedia(items) {
  const cache = await cached("wikipedia-kana.json", async () => ({}));
  const titles = [...new Set(items.filter((w) => !w.kana).map((w) => w.article))].filter((t) => !(t in cache));
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const url =
      "https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exlimit=20&redirects=1&titles=" +
      encodeURIComponent(batch.join("|"));
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const json = await res.json();
    const redirect = new Map((json.query.redirects ?? []).map((r) => [r.to, r.from]));
    for (const page of Object.values(json.query.pages ?? {})) {
      const m = (page.extract ?? "").match(/[（(]\s*([\u3041-\u309f\u30a1-\u30faー・\s]+?えき)\s*[）)、,，]/);
      cache[redirect.get(page.title) ?? page.title] = m ? m[1] : null;
    }
    batch.forEach((t) => {
      if (!(t in cache)) cache[t] = null;
    });
    await sleep(500);
  }
  fs.writeFileSync(path.join(CACHE_DIR, "wikipedia-kana.json"), JSON.stringify(cache));
  for (const w of items) if (!w.kana && cache[w.article]) w.wikipediaKana = cache[w.article];
}

// ---------------------------------------------------------------------------------
async function main() {
  const existing = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const s12 = loadS12Stations();
  const wikidata = await loadWikidata();
  console.log(`S12: ${s12.length}駅 / Wikidata: 記事のある駅の項目 ${wikidata.length}件`);

  // 選ぶ
  const picked = new Map();
  for (const s of s12) if (s.total >= MIN_DAILY) picked.set(s, "ridership");
  const missingCapitals = [];
  for (const [name, lat, lon] of CAPITALS) {
    const key = normalize(name);
    const hit = s12
      .filter((s) => s.key === key)
      .map((s) => ({ s, km: distanceKm(s, { lat, lon }) }))
      .filter((c) => c.km <= 5)
      .sort((a, b) => a.km - b.km)[0];
    if (hit) {
      if (!picked.has(hit.s)) picked.set(hit.s, "capital");
    } else missingCapitals.push(name);
  }

  // 駅の少ない都道府県に、県内で乗降客数の多い駅を足す（--pref-min）
  if (PREF_MIN > 0) {
    const geo = await cached("gsi-muni.json", async () => ({}));
    const counts = new Map();
    for (const e of existing) counts.set(e.prefecture, (counts.get(e.prefecture) ?? 0) + 1);
    const chosen = [...existing];
    for (let pi = 0; pi < PREFECTURES.length; pi++) {
      const need = PREF_MIN - (counts.get(PREFECTURES[pi]) ?? 0);
      if (need <= 0) continue;
      const [, lat, lon] = CAPITALS[pi];
      // その県の県庁所在地が近い方から3番目までに入る駅に絞る（徳島県は150km圏内の上位が関西の駅で埋まった）
      const nearCapital = (s) =>
        CAPITALS.map(([, la, lo]) => distanceKm(s, { lat: la, lon: lo }))
          .sort((a, b) => a - b)
          .indexOf(distanceKm(s, { lat, lon })) < 3;
      const pool = s12.filter(
        (s) => s.total > 0 && !picked.has(s) && distanceKm(s, { lat, lon }) <= PREF_MIN_RADIUS_KM && nearCapital(s)
      );
      const got = [];
      for (const s of pool.slice(0, PREF_MIN_LOOKUPS)) {
        if (chosen.some((c) => distanceKm(c, s) < PREF_MIN_APART_KM)) continue;
        if ((await prefectureOf(s.lat, s.lon, geo)) !== pi) continue;
        picked.set(s, "pref-min");
        chosen.push(s);
        got.push(`${s.name}（${s.total}人）`);
        if (got.length >= need) break;
      }
      console.log(`  ${PREFECTURES[pi]}: ${need}駅足りない → ${got.join("、") || "候補なし"}`);
    }
    fs.writeFileSync(path.join(CACHE_DIR, "gsi-muni.json"), JSON.stringify(geo));
  }

  // 既に載っている駅を除く
  const isListed = (s) =>
    existing.some((e) => {
      const km = distanceKm(e, s);
      const names = existingNames(e.name_ja);
      // 言い換え（関西国際空港→関西空港）で合う駅は、ロッカーアプリ由来の座標がずれていることがあるので1kmまで見る
      const aliasKm = names.indexOf(s.key) > 0 && NAME_ALIASES[names[0]] === s.key ? 1.0 : SAME_NAME_KM;
      return km <= SAME_PLACE_KM || (km <= aliasKm && names.includes(s.key));
    });
  // 名前が違っても200m以内なら同じ駅（「多摩センター」と「京王多摩センター」など）。乗降客数の多い方の名前で1駅にする
  // 先にまとめてから掲載済みかを見る。逆の順だと、まとめた先が掲載済みになった2回目の実行で
  // まとめられた側（戸越銀座など）が独立した駅として出てきてしまう
  const clusters = [];
  for (const [s, reason] of [...picked.entries()].sort((a, b) => b[0].total - a[0].total)) {
    const near = clusters.find((c) => distanceKm(c.rep, s) <= SAME_PLACE_KM);
    if (near) near.members.push(s);
    else clusters.push({ rep: s, reason, members: [s] });
  }
  const fresh = [];
  const mergedAway = [];
  for (const c of clusters) {
    if (c.members.some(isListed)) continue;
    for (const m of c.members.slice(1)) {
      c.rep.total += m.total;
      mergedAway.push(`${m.name} → ${c.rep.name}`);
    }
    fresh.push([c.rep, c.reason]);
  }
  console.log(`選んだ駅: ${picked.size}（うち掲載済み ${picked.size - fresh.length}、新規 ${fresh.length}）`);

  // Wikidataと合わせる
  const geoCache = await cached("gsi-muni.json", async () => ({}));
  const added = [];
  const unmatched = [];
  const matches = new Map(fresh.map(([s]) => [s, matchWikidata(s, wikidata)]));
  await fillKanaFromWikipedia([...matches.values()].filter(Boolean));
  let n = 0;
  for (const [s, reason] of fresh) {
    n++;
    const w = matches.get(s);
    const kana = w && kanaOf(w);
    if (!w || !kana) {
      unmatched.push({ name: s.name, total: s.total, lat: s.lat, lon: s.lon, why: w ? "読みがな無し" : "Wikidataに無い" });
      continue;
    }
    // 同名の別駅（近鉄今里とOsaka Metro今里など）が同じ項目に合ったときは、乗降客数の多い方だけ載せる
    if (added.some((a) => a.w.id === w.id) || existing.some((e) => distanceKm(e, w) <= 0.05)) {
      unmatched.push({ name: s.name, total: s.total, lat: s.lat, lon: s.lon, why: "同じWikidata項目に合った" });
      continue;
    }
    const prefIndex = await prefectureOf(w.lat, w.lon, geoCache);
    if (n % 100 === 0) {
      process.stdout.write(`  ${n}/${fresh.length}\n`);
      fs.writeFileSync(path.join(CACHE_DIR, "gsi-muni.json"), JSON.stringify(geoCache));
    }
    if (prefIndex == null || !PREFECTURES[prefIndex]) {
      unmatched.push({ name: s.name, total: s.total, lat: w.lat, lon: w.lon, why: "都道府県が分からない" });
      continue;
    }
    added.push({
      s,
      reason,
      w,
      kana,
      prefIndex,
      slug: w.en ? slugFromEnglish(w.en) : null,
    });
  }
  fs.writeFileSync(path.join(CACHE_DIR, "gsi-muni.json"), JSON.stringify(geoCache));

  // 同じ名前の駅（府中・大久保など）は、新しく足す側の名前をWikipediaの記事名で区別する
  // （「尼崎駅 (阪神)」→「尼崎駅（阪神）」）。記事名に括弧が無ければ都道府県を付ける
  const nameCount = new Map();
  const bump = (name) => nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  existing.forEach((e) => bump(e.name_ja));
  const suffixOf = (a) => (a.w.ja.endsWith("停留場") ? "停留場" : "駅");
  added.forEach((a) => bump(a.s.name.replace(/[（(].*?[）)]$/, "") + suffixOf(a)));

  const usedSlugs = new Set(existing.map((e) => e.slug));
  const out = [];
  for (const a of added.sort((x, y) => y.s.total - x.s.total)) {
    // S12の「下祗園」は「下祇園」が正しい表記
    a.s.name = a.s.name.replace(/祗/g, "祇");
    const baseName = a.s.name + suffixOf(a);
    const plainName = a.s.name.replace(/[（(].*?[）)]$/, "") + suffixOf(a);
    const pref = PREFECTURES[a.prefIndex];
    const qualifier = a.w.article.match(/\s*\((.+)\)$/)?.[1] ?? pref;
    const name_ja = nameCount.get(plainName) > 1 ? `${plainName}（${qualifier}）` : baseName;
    let slug = a.slug || "";
    if (!slug || usedSlugs.has(slug)) slug = `${slug || "station"}-${PREF_ROMAJI[a.prefIndex]}`;
    for (let i = 2; usedSlugs.has(slug); i++) slug = `${slug.replace(/-\d+$/, "")}-${i}`;
    usedSlugs.add(slug);
    out.push({
      slug,
      name_ja,
      kana: a.kana,
      prefecture: pref,
      lat: Math.round(a.w.lat * 10000) / 10000,
      lon: Math.round(a.w.lon * 10000) / 10000,
      _daily: a.s.total,
      _reason: a.reason,
      _wikidata: a.w.id,
      _article: a.w.article,
    });
  }

  // 既存駅の読みがなを直す（ロッカーアプリから写したものに「しにょこはま」等の誤りがある）。
  // 事業者名付きの掲載（「東急 渋谷駅」）は読みに事業者名を含むので触らない
  const kanaFixes = [];
  for (const e of existing) {
    if (e.name_ja.includes(" ")) continue;
    const key = normalize(e.name_ja);
    const w = wikidata
      .filter((x) => x.key === key && x.kana)
      .map((x) => ({ x, km: distanceKm(e, x) }))
      .filter((c) => c.km <= WIKIDATA_MATCH_KM)
      .sort((a, b) => a.km - b.km)[0]?.x;
    const kana = w && kanaOf(w);
    if (kana && kana !== e.kana) {
      kanaFixes.push({ slug: e.slug, name: e.name_ja, from: e.kana, to: kana });
      e.kana = kana;
    }
  }

  const byPref = {};
  for (const s of [...existing, ...out]) byPref[s.prefecture] = (byPref[s.prefecture] ?? 0) + 1;
  const report = {
    min_daily: MIN_DAILY,
    existing: existing.length,
    added: out.length,
    total: existing.length + out.length,
    prefectures: Object.keys(byPref).length,
    missing_capitals: missingCapitals,
    merged_away: mergedAway,
    duplicate_names: [
      ...new Set(
        out
          .map((o) => o.name_ja)
          .filter((n, i, all) => all.indexOf(n) !== i || existing.some((e) => e.name_ja === n))
      ),
    ],
    by_prefecture: byPref,
    unmatched,
    kana_fixes: kanaFixes,
    stations: out,
  };
  fs.writeFileSync(path.join(CACHE_DIR, "station-candidates.json"), JSON.stringify(report, null, 2));
  console.log(
    `新規 ${out.length}駅（Wikidataで合わず見送り ${unmatched.length}） → 合計 ${report.total}駅・${report.prefectures}都道府県`
  );
  console.log(`既存駅の読みの修正: ${kanaFixes.filter((k) => k.to).length}件`);
  if (missingCapitals.length) console.log(`S12で見つからなかった県庁所在地の駅: ${missingCapitals.join("、")}`);

  if (!WRITE) {
    console.log(`試運転のため stations.json は書き換えていません（一覧: ${path.join(CACHE_DIR, "station-candidates.json")}）`);
    return;
  }
  const clean = out.map(({ slug, name_ja, kana, prefecture, lat, lon }) => ({ slug, name_ja, kana, prefecture, lat, lon }));
  fs.writeFileSync(STATIONS_PATH, JSON.stringify([...existing, ...clean], null, 2) + "\n");
  console.log(`stations.json に ${clean.length}駅を足しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
