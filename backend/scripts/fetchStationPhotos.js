/**
 * 駅ページの背景に出す「駅と駅前の写真」を集め、backend/data/station-photos.json に書き出す
 * （2026-09-29追加）。
 *
 * 写真の出どころ: 日本語版Wikipediaの駅の記事に載っている写真（実体はWikimedia Commons）。
 * 位置情報で近くの写真を拾う方法も試したが、電車の形式写真や料理の写真が大量に混ざり、
 * 人が1枚ずつ見ないと使えなかった。記事に載っている写真は編集者が選んだものなので、
 * ファイル名と説明文で機械的に振り分けるだけで品質がそろう。
 *
 * 選び方:
 * - JPEGで、横長（縦横比1.25〜3.2）、幅1600px以上
 * - ホーム・改札・駅名標・車両・古い空撮など「駅前の景色」でないものはファイル名と説明文で除く
 * - 出口・駅舎・広場・周辺の建物を表す語があるものを先に並べ、最大 MAX_PHOTOS 枚
 *
 * ライセンス: すべてCC BY / CC BY-SA / CC0 / パブリックドメインのいずれか。画面に撮影者名と
 * ライセンスを出す必要がある（CC BYの条件）ので、その情報も一緒に保存する。
 * 画像そのものはリポジトリに入れず、Wikimediaのサムネイルを直接読み込む。
 *
 * 実行: node backend/scripts/fetchStationPhotos.js [--only slug1,slug2] [--missing]
 * （349駅で15分ほど。Wikipedia側の記事が更新されたら実行し直す）
 */

const fs = require("fs");
const path = require("path");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-photos.json");
const UA = "kakuni-lab-eki/1.0 (https://eki.kakuni-lab.com)";

const MAX_PHOTOS = 6;
const MIN_WIDTH = 1600;
// Wikimediaが配るサムネイルの幅（決まった幅しか生成されないため、その中から選ぶ）
const THUMB_WIDTH = 1280;
const REQUEST_INTERVAL_MS = 1000;

// 使わない写真。ファイル名と説明文のどちらかに含まれていたら除く
const EXCLUDE = new RegExp(
  [
    "ホーム", "番線", "platform", "home\\d", "home[-_ ]", "のりば", "乗り場",
    "改札", "gate", "ticket", "駅舎内", "inside", "コンコース", "concourse",
    "駅名標", "sign", "標識", "時刻表", "発車",
    "空撮", "空中写真", "aerial", "航空写真",
    "明治", "大正", "昭和", "19[0-9]{2}", "18[0-9]{2}", "circa",
    "路線図", "配線", "map", "地図", "logo", "ロゴ",
    "系", "形電車", "series", "車両", "列車", "electric car", "train",
    "転車台", "turntable", "工事中", "under construction", "境界線",
    // 2026-09-29の全駅実行で混ざっていたもの（駅構内の設備・通路・売店）
    "構内", "断路器", "変電", "通路", "passage", "kiosk", "キオスク", "売店", "待合室",
    "券売機", "vending", "machine", "精算", "トイレ", "toilet",
  ].join("|"),
  "i"
);

// 先に出したい写真（駅の外観・出口・駅前・周辺の建物）
const PREFER = new RegExp(
  [
    // 方角の英単語だけ（east など）にすると「JR East」に当たってしまうので、出口の形で書く
    "口", "exit", "entrance", "駅舎", "外観", "exterior", "building",
    "north side", "south side", "east side", "west side", "広場", "駅前", "周辺", "plaza", "square",
    "モール", "mall", "商店街", "眺め", "view", "panorama", "street", "通り",
  ].join("|"),
  "i"
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, retries = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.ok) return res.json();
    if (i >= retries) throw new Error(`${res.status} ${url.slice(0, 80)}`);
    await sleep(5000 * (i + 1));
  }
}

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 「東急 渋谷駅」「京王府中駅」→ 記事の題名と照らし合わせる候補（渋谷 / 府中）
const OPERATOR_PREFIXES = ["京王", "京阪", "阪急", "阪神", "東急", "西武", "東武", "小田急", "京急", "京成", "南海", "近鉄"];
function nameCandidates(nameJa) {
  // 同名の駅を区別する括弧書き（「尼崎駅（阪神）」「今里駅（Osaka Metro）」）は比べる前に外す
  const base = nameJa.replace(/（[^）]*）$/, "").replace(/^.*\s/, "").replace(/(駅|停留場)$/, "");
  const names = [base];
  for (const prefix of OPERATOR_PREFIXES) {
    if (base.startsWith(prefix) && base.length > prefix.length) names.push(base.slice(prefix.length));
  }
  return names.map((n) => n.replace(/ヶ/g, "ケ"));
}

/**
 * 駅の座標から600m以内の「駅」（Wikidata）で、日本語版Wikipediaの記事を持つものを探す。
 * 同名の駅は全国に多いので、名前が合う中で最も近いものを選ぶ
 */
async function findArticle(station) {
  const query = `SELECT ?itemLabel ?article ?dist WHERE {
    SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${station.lon} ${station.lat})"^^geo:wktLiteral . bd:serviceParam wikibase:radius "0.6" . bd:serviceParam wikibase:distance ?dist. }
    ?item wdt:P31/wdt:P279* wd:Q55488 .
    ?article schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ja". }
  } ORDER BY ?dist LIMIT 30`;
  const json = await getJson(
    "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query)
  );
  const rows = json.results.bindings.map((b) => ({
    title: decodeURIComponent(b.article.value.split("/wiki/")[1]).replace(/_/g, " "),
    dist: Number(b.dist.value),
  }));
  const names = nameCandidates(station.name_ja);
  const titleBase = (t) => t.replace(/\s*\(.*\)$/, "").replace(/(駅|停留場)$/, "").replace(/ヶ/g, "ケ");
  // 名前が合わない（「Osaka Metro なんば駅」の座標が記事側とずれている等）ときは、ごく近い駅の記事を使う
  return (
    rows.find((r) => names.includes(titleBase(r.title)))?.title ??
    rows.find((r) => r.dist <= 0.3)?.title ??
    null
  );
}

const IMAGE_PROPS =
  "&prop=imageinfo&iiprop=url|size|mime|extmetadata" +
  `&iiurlwidth=${THUMB_WIDTH}` +
  "&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ImageDescription";

// 自由に使えるライセンスだけ（CC BY / CC BY-SA / CC0 / パブリックドメイン）。
// 記事に載る写真はほぼこれだが、位置で探すCommonsの写真には「利用条件付き」なども混ざるため確かめる
const FREE_LICENSE = /^(CC BY|CC-BY|CC0|Public domain|パブリック・ドメイン|PD|Copyrighted free use)/i;

async function photosOf(title, opts = {}) {
  const url =
    "https://ja.wikipedia.org/w/api.php?action=query&format=json&generator=images&gimlimit=200" +
    IMAGE_PROPS +
    "&titles=" +
    encodeURIComponent(title);
  const json = await getJson(url);
  return pickPhotos(Object.values(json.query?.pages || {}), opts);
}

/**
 * 写真の候補を選ぶ。opts:
 * - minWidth / minRatio: 大きさと縦横比の下限（既定は MIN_WIDTH・1.25）
 * - exclude: 除く語（既定は EXCLUDE）
 * - require: この条件（ファイル名＋説明文）に合うものだけ（位置で探すときに駅の写真に絞る）
 */
function pickPhotos(pages, opts = {}) {
  const minWidth = opts.minWidth ?? MIN_WIDTH;
  const minRatio = opts.minRatio ?? 1.25;
  const exclude = opts.exclude ?? EXCLUDE;
  const candidates = [];
  for (const page of pages) {
    const ii = page.imageinfo?.[0];
    if (!ii || ii.mime !== "image/jpeg" || ii.width < minWidth) continue;
    const ratio = ii.width / ii.height;
    if (ratio < minRatio || ratio > 3.2) continue;
    const meta = ii.extmetadata || {};
    const license = meta.LicenseShortName?.value;
    if (!license || !FREE_LICENSE.test(license)) continue;
    const fileName = page.title.replace(/^(ファイル|File):/, "");
    // 多言語の説明が「英語zh:中国語ja:日本語」のように連結されていることがあるので、日本語の部分を取る
    const rawDescription = stripHtml(meta.ImageDescription?.value);
    const jaPart = rawDescription.includes("ja:") ? rawDescription.split("ja:").pop() : rawDescription;
    const description = jaPart.trim().slice(0, 80);
    const text = `${fileName} ${description}`;
    if (exclude.test(text)) continue;
    if (opts.require && !opts.require(text)) continue;
    candidates.push({
      // 末尾の計測用クエリ（?utm_source=...）は外す
      src: ii.thumburl.split("?")[0],
      width: ii.thumbwidth,
      height: ii.thumbheight,
      page: ii.descriptionurl,
      // 説明文が英語だけ・ファイル名そのままのものは見出しに向かないので空にする
      // 「User:〇〇 撮影日：…」のような撮影メモも見出しに向かないので空にする
      caption:
        /[ぁ-んァ-ヶ一-龠]/.test(description) && !/User:|撮影日|撮影場所|撮影者/.test(description)
          ? description
          : "",
      // 撮影者が機械的に読めない形で書かれているファイルは、ファイルページを見てもらう
      artist: /コンピュータが読み取れる|not machine-readable/i.test(stripHtml(meta.Artist?.value))
        ? "ファイルページ参照"
        : stripHtml(meta.Artist?.value).slice(0, 60) || "ファイルページ参照",
      license,
      license_url: meta.LicenseUrl?.value || null,
      prefer: PREFER.test(text),
    });
  }
  candidates.sort((a, b) => Number(b.prefer) - Number(a.prefer));
  return candidates.slice(0, MAX_PHOTOS).map(({ prefer, ...photo }) => photo);
}

// --- 写真が1枚も無い駅の補い（--fill。2026-09-30追加） ----------------------------------------
// ユーザーの指示「写真が無いのはセンスが悪いので全駅に写真を」。無料で使える写真だけを、次の順に探す。
// 1. 同じ記事で条件を緩める（ホーム・改札・駅名標も可、幅800px以上、縦横比1.0以上）
// 2. Wikimedia Commons で駅から500m以内に撮られた写真のうち、ファイル名か説明文に駅名が入っているもの
// 3. 駅のある市区町村の記事の写真（駅の写真ではないことを出典表示で明記する）

// 条件を緩めても使わないもの（車両・地図・ロゴ・古い写真・設備）
const EXCLUDE_RELAXED = new RegExp(
  [
    "空撮", "空中写真", "aerial", "航空写真",
    "明治", "大正", "昭和", "19[0-9]{2}", "18[0-9]{2}", "circa",
    "路線図", "配線", "map", "地図", "logo", "ロゴ",
    "系", "形電車", "series", "車両", "列車", "electric car", "train",
    "転車台", "turntable", "工事中", "under construction", "境界線",
    "断路器", "変電", "券売機", "vending", "machine", "精算", "トイレ", "toilet",
    // 市区町村の記事に多い、景色でないもの
    "旗", "flag", "紋", "emblem", "symbol", "シンボル", "マーク", "位置図", "location", "庁舎内",
    "料理", "food", "dish", "肖像", "portrait",
  ].join("|"),
  "i"
);

async function relaxedPhotos(article) {
  return photosOf(article, { minWidth: 800, minRatio: 1.0, exclude: EXCLUDE_RELAXED });
}

// 駅名の書き方の候補（ファイル名は英語のことが多いので、URL用の英字名も使う）
function nameMatchers(station) {
  const ja = nameCandidates(station.name_ja);
  const en = station.slug
    .replace(/-(hokkaido|aomori|iwate|miyagi|akita|yamagata|fukushima|ibaraki|tochigi|gunma|saitama|chiba|tokyo|kanagawa|niigata|toyama|ishikawa|fukui|yamanashi|nagano|gifu|shizuoka|aichi|mie|shiga|kyoto|osaka|hyogo|nara|wakayama|tottori|shimane|okayama|hiroshima|yamaguchi|tokushima|kagawa|ehime|kochi|fukuoka|saga|nagasaki|kumamoto|oita|miyazaki|kagoshima|okinawa|d+)$/, "")
    .replace(/-/g, "");
  return (text) => {
    const t = text.replace(/ヶ/g, "ケ");
    const latin = text.toLowerCase().replace(/[^a-z]/g, "");
    return ja.some((n) => t.includes(n)) || (en.length >= 4 && latin.includes(en));
  };
}

async function geoPhotos(station) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch" +
    `&ggscoord=${station.lat}|${station.lon}&ggsradius=500&ggslimit=100&ggsnamespace=6` +
    IMAGE_PROPS;
  const json = await getJson(url);
  return pickPhotos(Object.values(json.query?.pages || {}), {
    minWidth: 800,
    minRatio: 1.0,
    exclude: EXCLUDE_RELAXED,
    require: nameMatchers(station),
  });
}

// 駅の記事 → Wikidataの「所在地」（P131）→ その市区町村の日本語版の記事名
async function municipalityArticle(article) {
  const query = `SELECT ?title WHERE {
    ?s schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ${JSON.stringify(article)}@ja .
    ?item wdt:P131 ?m .
    ?a schema:about ?m ; schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ?title .
  } LIMIT 1`;
  const json = await getJson("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query));
  return json.results.bindings[0]?.title.value ?? null;
}

async function fillStation(station, entry) {
  let article = entry?.article ?? null;
  if (!article) {
    article = await findArticle(station);
    await sleep(REQUEST_INTERVAL_MS);
  }
  if (article) {
    const photos = await relaxedPhotos(article);
    await sleep(REQUEST_INTERVAL_MS);
    if (photos.length > 0) return { article, photos, source: "article" };
  }
  const geo = await geoPhotos(station);
  await sleep(REQUEST_INTERVAL_MS);
  if (geo.length > 0) return { article, photos: geo, source: "commons-geo" };
  if (article) {
    const muni = await municipalityArticle(article);
    await sleep(REQUEST_INTERVAL_MS);
    if (muni) {
      const photos = await photosOf(muni, { minWidth: 1000, exclude: EXCLUDE_RELAXED });
      if (photos.length > 0) return { article: muni, photos, source: "municipality", station_article: article };
    }
  }
  return { article, photos: [] };
}

async function main() {
  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1].split(",");
  const existing = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")) : {};
  const result = { ...existing };

  // --missing: まだ調べていない駅だけ。25駅ごとに書き出すので、止まっても同じコマンドで続きから再開できる
  const missing = process.argv.includes("--missing");
  const save = () => fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");

  // --fill: 写真が1枚も無い駅だけを、条件を緩めた順に補う（fillStation）
  if (process.argv.includes("--fill")) {
    const empty = stations.filter((s) => (!only || only.includes(s.slug)) && !(existing[s.slug]?.photos?.length > 0));
    console.log(`写真の無い${empty.length}駅を補います`);
    const bySource = {};
    let n = 0;
    for (const station of empty) {
      try {
        const filled = await fillStation(station, existing[station.slug]);
        result[station.slug] = filled;
        bySource[filled.source ?? "なし"] = (bySource[filled.source ?? "なし"] ?? 0) + 1;
        console.log(`[${station.slug}] ${filled.source ?? "見つからず"} ${filled.article ?? ""} → ${filled.photos.length}枚`);
      } catch (err) {
        console.error(`[${station.slug}] 失敗（既存データを保持）: ${err.message}`);
      }
      if (++n % 25 === 0) save();
    }
    save();
    console.log(`\n補った結果: ${JSON.stringify(bySource)}`);
    return;
  }
  const targets = stations.filter((s) => (!only || only.includes(s.slug)) && (!missing || !existing[s.slug]));
  console.log(`${targets.length}駅を調べます`);
  let withPhotos = 0;
  let done = 0;
  // --articles <json>: 駅（slug）→ 記事名 の対応が分かっているときは、Wikidataで探す問い合わせを省く
  // （addStations.js の候補一覧 station-candidates.json の _article。2026-09-30、1,515駅を足したときに追加）
  const articlesIdx = process.argv.indexOf("--articles");
  const knownArticles = new Map();
  if (articlesIdx !== -1) {
    const list = JSON.parse(fs.readFileSync(process.argv[articlesIdx + 1], "utf-8"));
    for (const s of list.stations ?? []) if (s._article) knownArticles.set(s.slug, s._article);
  }
  for (const station of targets) {
    try {
      let article = knownArticles.get(station.slug);
      if (!article) {
        article = await findArticle(station);
        await sleep(REQUEST_INTERVAL_MS);
      }
      const photos = article ? await photosOf(article) : [];
      result[station.slug] = { article, photos };
      if (photos.length > 0) withPhotos++;
      console.log(`[${station.slug}] ${article ?? "記事なし"} → ${photos.length}枚`);
    } catch (err) {
      console.error(`[${station.slug}] 失敗（既存データを保持）: ${err.message}`);
    }
    await sleep(REQUEST_INTERVAL_MS);
    if (++done % 25 === 0) save();
  }

  save();
  console.log(`\n写真のある駅: ${withPhotos}駅 -> ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
