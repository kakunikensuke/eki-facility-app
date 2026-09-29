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
 * 実行: node backend/scripts/fetchStationPhotos.js [--only slug1,slug2]
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
  const base = nameJa.replace(/^.*\s/, "").replace(/駅$/, "");
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
  const titleBase = (t) => t.replace(/\s*\(.*\)$/, "").replace(/駅$/, "").replace(/ヶ/g, "ケ");
  // 名前が合わない（「Osaka Metro なんば駅」の座標が記事側とずれている等）ときは、ごく近い駅の記事を使う
  return (
    rows.find((r) => names.includes(titleBase(r.title)))?.title ??
    rows.find((r) => r.dist <= 0.3)?.title ??
    null
  );
}

async function photosOf(title) {
  const url =
    "https://ja.wikipedia.org/w/api.php?action=query&format=json&generator=images&gimlimit=200" +
    "&prop=imageinfo&iiprop=url|size|mime|extmetadata" +
    `&iiurlwidth=${THUMB_WIDTH}` +
    "&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ImageDescription" +
    "&titles=" +
    encodeURIComponent(title);
  const json = await getJson(url);
  const candidates = [];
  for (const page of Object.values(json.query?.pages || {})) {
    const ii = page.imageinfo?.[0];
    if (!ii || ii.mime !== "image/jpeg" || ii.width < MIN_WIDTH) continue;
    const ratio = ii.width / ii.height;
    if (ratio < 1.25 || ratio > 3.2) continue;
    const meta = ii.extmetadata || {};
    const license = meta.LicenseShortName?.value;
    if (!license) continue;
    const fileName = page.title.replace(/^ファイル:/, "");
    // 多言語の説明が「英語zh:中国語ja:日本語」のように連結されていることがあるので、日本語の部分を取る
    const rawDescription = stripHtml(meta.ImageDescription?.value);
    const jaPart = rawDescription.includes("ja:") ? rawDescription.split("ja:").pop() : rawDescription;
    const description = jaPart.trim().slice(0, 80);
    const text = `${fileName} ${description}`;
    if (EXCLUDE.test(text)) continue;
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

async function main() {
  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1].split(",");
  const existing = fs.existsSync(OUTPUT_PATH) ? JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")) : {};
  const result = { ...existing };

  let withPhotos = 0;
  for (const station of stations.filter((s) => !only || only.includes(s.slug))) {
    try {
      const article = await findArticle(station);
      await sleep(REQUEST_INTERVAL_MS);
      const photos = article ? await photosOf(article) : [];
      result[station.slug] = { article, photos };
      if (photos.length > 0) withPhotos++;
      console.log(`[${station.slug}] ${article ?? "記事なし"} → ${photos.length}枚`);
    } catch (err) {
      console.error(`[${station.slug}] 失敗（既存データを保持）: ${err.message}`);
    }
    await sleep(REQUEST_INTERVAL_MS);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n写真のある駅: ${withPhotos}駅 -> ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
