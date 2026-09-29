// ビルド後に dist へ「駅ごとの静的HTML」と「sitemap.xml」を生成するスクリプト
// （package.json の build から vite build に続けて実行される）
//
// なぜ必要か（2026-08-01時点で本番が抱えていた問題）:
// 1. CSRのSPAなので、どのURLでもサーバーが返すHTMLは同一（1,482バイト・title は
//    「住みやすさ駅前スコア」・`<div id="root"></div>` が空）だった。
// 2. さらにこのアプリは react-helmet 等を使っておらず、**JSが実行された後ですら**
//    全349駅ページの title が同一だった。
// 3. 駅の遷移が `<select>` + navigate() のみで、駅ページへの `<a href>` がアプリ内に
//    1つも存在しない。つまりJSを実行するクローラですら 1駅目以外を発見できない。
// 4. robots.txt も sitemap.xml も無かった。
//
// →「Googleが349駅ページの存在を知る手段が皆無」という状態だったため、
//   ビルド時に各駅の静的HTMLを吐き、トップに全駅への内部リンクを置き、
//   sitemap.xml も生成することで発見可能にする。
//
// ReactはcreateRootで#rootを丸ごと置き換えるため（hydrateRootではない）、ここで
// 埋め込んだ本文はマウント時に破棄される。hydration mismatchは発生しない。
//
// 出力先は `<パス>.html`（`<パス>/index.html` ではない）。後者だとCloudflare側の
// html_handling既定（auto-trailing-slash）で `/ikebukuro` → `/ikebukuro/` へ
// リダイレクトが挟まり、sitemap/canonicalが指すスラッシュなしURLと食い違うため。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findNearbyStations, formatDistance } from "../src/nearbyStations.js";
import {
  categoryReachText,
  concentrationText,
  landText,
  lineRankText,
  localRankHeading,
  nearbyFacilitiesLead,
  nearbyFacilityRows,
  nearbySummaryText,
  nearestComparisonText,
  photoCredit,
  photoSourceText,
  prefRankText,
  ridershipText,
  similarLead,
  similarStationText,
  summaryText,
  topShare,
} from "../src/stationProfileText.js";
import { DOMAINS, ITEMS, MAX_TOTAL } from "../src/livabilityDefs.js";
import {
  SEARCH_BLOCKS,
  GUIDE_BLOCKS,
  ABOUT_BLOCKS,
  PRIVACY_BLOCKS,
  COMPARE_BLOCKS,
  CONTACT_BLOCKS,
  CONTACT_RECEIVED_BLOCKS,
  CONTACT_FORM_ENDPOINT,
  CONTACT_FORM_FIELDS,
  CONTACT_FORM_HIDDEN,
  contactBlocks,
} from "../src/content/pages.js";
import {
  HAZARD_KINDS,
  HAZARD_NOTES,
  HAZARD_SOURCE,
  hazardAtStationText,
  hazardKindText,
  hazardSummaryText,
} from "../src/hazardText.js";
import {
  CONTENT_SECTIONS,
  SITE_NAME,
  topTitle,
  topDescription,
  stationTitle,
  stationDescription,
  STATIC_PAGES,
} from "../src/pageMeta.js";
import {
  PRESETS,
  DEFAULT_PRESET,
  buildTierTable,
  prefecturePath,
  presetWeights,
  resultReasons,
  searchStations,
} from "../src/stationSearch.js";
// 採点・順位・公的データ・写真・似ている駅は、APIのJSONと同じ物をここで作って使う
// （scripts/stationBundle.js。2026-09-29、画面と静的HTMLで中身がずれないよう1か所にまとめた）
import { loadData, buildAll } from "./stationBundle.js";
// 路線ページと記事。本文HTMLはここで作った物を画面（DocPage.jsx）も使う
import { buildDocs } from "./contentDocs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// デプロイ先が1つしかないので既定値を本番URLにしている（Cloudflare Pages側の
// 環境変数設定を増やさずに済ませるため）。別ドメインで使う場合のみ環境変数で上書きする。
const SITE_URL = process.env.VITE_SITE_URL || "https://eki.kakuni-lab.com";
const DIST = path.join(__dirname, "..", "dist");

const DATA = loadData();
const { stations } = DATA;
const { bundles, matrix } = buildAll(DATA);
const { docs: DOCS, nav: DOC_NAV } = buildDocs(bundles, DATA.stationLines, matrix);

const TEMPLATE_PATH = path.join(DIST, "index.html");
if (!fs.existsSync(TEMPLATE_PATH)) {
  throw new Error(`dist/index.html がありません。先に vite build を実行してください: ${TEMPLATE_PATH}`);
}
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, "utf-8");

// --- HTML組み立て -----------------------------------------------------------

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function link(href, text) {
  return `<a href="${esc(href)}">${esc(text)}</a>`;
}

function metaTags({ title, description, canonicalPath, jsonLd, noindex }) {
  const url = `${SITE_URL}${canonicalPath}`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
  ];
  // 検索に出しても意味がないページ（送信完了ページ、集計データが極端に乏しい駅）は
  // インデックスさせない。中身の薄いページを検索対象に差し出すと、サイト全体が
  // 「有用性の低いコンテンツ」と判定される要因になる。リンクは通常どおり辿らせるので
  // nofollow は付けない。
  if (noindex) {
    tags.push(`<meta name="robots" content="noindex,follow" />`);
  }
  tags.push(...[
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
  ]);
  // jsonLdは単体でも配列でも受ける（駅ページはPlaceとBreadcrumbListの2つを出す）
  for (const item of [].concat(jsonLd ?? [])) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(item)}</script>`);
  }
  return tags.map((tag) => `    ${tag}`).join("\n");
}

// 全ページ共通のフッター。
//
// これが無かったことが、AdSenseで2回続けて「有用性の低いコンテンツ」と判定された
// 最大の原因と見ている（2026-08-29）。React側は components/Footer.jsx を全ページに
// 置いているが、それはJSを実行して初めて現れるもので、プリレンダした静的HTMLには
// 1本も入っていなかった。サイトの98%を占める駅ページの静的HTMLには
// 「駅一覧」と「駅を比較する」しかリンクが無く、JSを実行しないクローラや審査ボットからは
// 運営者情報・プライバシーポリシー・お問い合わせのどれにも到達できない状態だった。
// 2026-08-15の対策でそれらのページの本文は充実させたが、そこへの経路を作らなかったため
// 審査で読まれていなかった可能性が高い。
//
// components/Footer.jsx と同じリンク構成を保つこと（片方だけ足すとズレる）。
function siteFooterHtml(currentPath) {
  const items = [
    { path: "/", label: "駅一覧" },
    ...CONTENT_SECTIONS,
    ...STATIC_PAGES.filter((p) => !p.hideFromNav).map((p) => ({
      path: p.path,
      label: p.heading,
    })),
  ];
  const links = items
    .filter((item) => item.path !== currentPath)
    .map((item) => link(item.path, item.label))
    .join(" ／ ");

  return (
    `<footer>` +
    `<nav aria-label="サイト内リンク"><p>${links}</p></nav>` +
    // ODbLライセンスの要求により全ページに出典表示が必要（CLAUDE.md参照）
    `<p>店舗数の集計には <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> のデータを利用しています（地図データ: © OpenStreetMap contributors／ODbLライセンス）。</p>` +
    `<p>${esc(SITE_NAME)} — 運営: kakuni-lab</p>` +
    `</footer>`
  );
}

function renderPage(page) {
  let html = TEMPLATE;
  // テンプレート（index.html）が持つ既定のtitle/descriptionはページ固有のものに差し替える
  html = html.replace(/\s*<title>[\s\S]*?<\/title>/, "");
  html = html.replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, "");
  html = html.replace("</head>", `${metaTags(page)}\n  </head>`);
  html = html.replace('<div id="root"></div>', `<div id="root">${page.body}</div>`);
  return html;
}

function writePage(page) {
  const outPath =
    page.canonicalPath === "/"
      ? path.join(DIST, "index.html")
      : path.join(DIST, `${page.canonicalPath.replace(/^\//, "")}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderPage(page));
}

// --- 各ページ ---------------------------------------------------------------

const DEFAULT_WALK_MINUTES = matrix.default_walk_minutes;
const DEFAULT_TABLE = buildTierTable(matrix, DEFAULT_WALK_MINUTES);

// 件数は TopPage.jsx / SearchPage.jsx と揃える規約
const PURPOSE_LIMIT = 5;
const RANKING_LIMIT = 10;
// トップページに出す路線の数（駅の多い順）。残りは /lines から。TopPage.jsx と揃える規約
const TOP_LINES_LIMIT = 24;
const SEARCH_PAGE_SIZE = 30;

// 検索結果1行ぶん。画面（SearchPage.jsx / TopPage.jsx）と同じ根拠を文字で出す
function resultItemHtml(row, weights) {
  const reasons = resultReasons(row, weights)
    .map((r) => `${esc(r.label)} ${esc(r.score)}点`)
    .join("・");
  return `<li>${link(`/${row.station.slug}`, row.station.name_ja)}（${esc(row.station.prefecture)}・総合${esc(
    row.total
  )}点）: ${reasons}／適合度${esc(row.fit)}</li>`;
}

// /search の静的HTML。JSが動く前・動かないクローラにも、初期状態（バランス・徒歩10分・
// 絞り込みなし）の結果を見せる
function searchPageHtml() {
  const weights = presetWeights(DEFAULT_PRESET);
  const { results, total } = searchStations(DEFAULT_TABLE, { weights });
  const preset = PRESETS.find((p) => p.key === DEFAULT_PRESET);
  return `<p>駅名が決まっていなくても大丈夫です。暮らし方と、なくては困る施設の条件から、全国の対応駅を絞り込んで並べます。</p>
      <h2>全国で条件に合う駅：${results.length}駅（全${total}駅中）</h2>
      <p>並び順：${esc(preset.label)}・徒歩${DEFAULT_WALK_MINUTES}分圏内。適合度は選んだ分野の点の重み付き平均（0〜100）です。</p>
      <ol>${results.slice(0, SEARCH_PAGE_SIZE).map((row) => resultItemHtml(row, weights)).join("")}</ol>`;
}

function topPage() {
  const description = topDescription(stations.length);

  const ranking = [...DEFAULT_TABLE.rows].sort((a, b) => b.total - a.total).slice(0, RANKING_LIMIT);
  const rankingHtml = `<ol>${ranking
    .map(
      (row) =>
        `<li>${link(`/${row.station.slug}`, row.station.name_ja)}（${esc(row.station.prefecture)}）: ${esc(
          row.total
        )}点／${DOMAINS.map((d) => `${d.label}${row.domains[d.key]}`).join("・")}</li>`
    )
    .join("")}</ol>`;

  const purposeHtml = PRESETS.filter((p) => p.key !== "balance")
    .map((preset) => {
      const weights = presetWeights(preset.key);
      const rows = searchStations(DEFAULT_TABLE, { weights }).results.slice(0, PURPOSE_LIMIT);
      return `<h3>${esc(preset.label)}</h3>
      <p>${esc(preset.lead)}</p>
      <ol>${rows.map((row) => resultItemHtml(row, weights)).join("")}</ol>
      <p>${link(`/search?preset=${preset.key}`, "この条件で絞り込む")}</p>`;
    })
    .join("");

  // 全駅への入口。2026-09-30に1,856駅へ増やしたので、全駅を直接並べるのをやめ、都道府県ページを経由させる。
  // ページの無い（駅の少ない）都道府県は一覧の該当欄へ飛ばす。全駅にたどり着けるかは verifyOutput が点検する
  const prefectureHtml = `<ul>${DOC_NAV.prefectures
    .map(
      (g) => `<li>${link(g.page ? `/pref/${g.slug}` : `/prefectures#${g.slug}`, g.name)}（${esc(g.count)}駅）</li>`
    )
    .join("")}</ul>
      <p>${link("/prefectures", "都道府県ごとの一覧と比較")}</p>`;
  const topLines = [...DOC_NAV.lines].sort((x, y) => y.count - x.count).slice(0, TOP_LINES_LIMIT);

  return {
    title: topTitle(),
    description,
    canonicalPath: "/",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      description,
      url: `${SITE_URL}/`,
    },
    body: `<main>
      <h1>駅の暮らしやすさを、${MAX_TOTAL}点で。</h1>
      <p>全国${stations.length}駅の徒歩5〜20分圏内にある${ITEMS.length}種類の施設を数え、買い物・食事・医療・子育て・生活・余暇の6分野で採点。住宅地の地価と乗降客数も並べて見られます。</p>
      <p>${link("/search", "駅名が決まっていない方は、条件から探す")}</p>
      <h2>総合点の高い駅（徒歩${DEFAULT_WALK_MINUTES}分圏内）</h2>
      <p>6分野の点の平均（小数1桁）。施設ごとに全国の対応駅の中での位置を出しているので、満点で頭打ちにならず上位の駅にも差がつきます。</p>
      ${rankingHtml}
      <h2>暮らし方から探す</h2>
      <p>目的に合う分野の点が高い駅の上位${PURPOSE_LIMIT}駅です（徒歩${DEFAULT_WALK_MINUTES}分圏内）。都道府県や最低軒数で絞り込むこともできます。</p>
      ${purposeHtml}
      <h2>データで見る駅選び</h2>
      <p>全国の駅の施設・地価・乗降客数・ハザードマップのデータから分かったことをまとめています。</p>
      <ul>${DOC_NAV.articles
        .map((x) => `<li>${link(`/article/${x.slug}`, x.heading)}: ${esc(x.summary)}</li>`)
        .join("")}</ul>
      <h2>路線から探す</h2>
      <p>路線ごとに、このサイトで扱っている駅を住みやすさの順に並べています。</p>
      <ul>${topLines.map((l) => `<li>${link(`/line/${l.slug}`, l.name)}（${esc(l.count)}駅）</li>`).join("")}</ul>
      <p>${link("/lines", `すべての路線（${DOC_NAV.lines.length}路線）`)}</p>
      <h2>都道府県から探す（${stations.length}駅）</h2>
      ${prefectureHtml}
    </main>
    ${siteFooterHtml("/")}`,
  };
}

function stationPage(station) {
  const b = bundles.get(station.slug);
  if (!b) return null;
  const main = b.tiers[b.default_walk_minutes];
  const tiers = b.walk_minutes.map((m) => b.tiers[m]);

  // 4段階の総合点・分野の点・施設の数を表にする。段階の切り替えは画面ではボタンだが、
  // クローラにも全段階の数字が見えるようにしておく
  const head = tiers.map((t) => `<th>徒歩${esc(t.walk_minutes)}分</th>`).join("");
  const totalRow = `<tr><th>総合点（${MAX_TOTAL}点満点）</th>${tiers
    .map((t) => `<td>${esc(t.total)}点（${esc(t.rank)}位）</td>`)
    .join("")}</tr>`;
  const domainRows = DOMAINS.map(
    (d) =>
      `<tr><th>${esc(d.label)}</th>${tiers
        .map((t) => `<td>${esc(t.domains[d.key].score)}点（${esc(t.domains[d.key].rank)}位）</td>`)
        .join("")}</tr>`
  ).join("");
  const itemRows = ITEMS.map(
    (item) =>
      `<tr><th>${esc(item.label)}</th>${tiers
        .map((t) => {
          const it = t.items[item.key];
          // 0軒に「上位◯%」を付けても意味をなさないので出さない（StationPage.jsx と同じ）
          return `<td>${esc(it.count)}軒${it.count > 0 ? `（上位${esc(topShare(it.pct))}%）` : ""}</td>`;
        })
        .join("")}</tr>`
  ).join("");

  const publicHtml =
    b.public.land || b.public.ridership
      ? `<h2>暮らしのコストと駅の規模</h2>
      ${[landText(b.public.land), ridershipText(b.public.ridership)]
        .filter(Boolean)
        .map((t) => `<p>${esc(t)}</p>`)
        .join("")}
      <p>出典: 国土数値情報（地価公示データ・駅別乗降客数データ）国土交通省（CC BY 4.0）を加工して作成</p>`
      : "";

  // 災害リスク（StationPage.jsx と同じ文言関数）
  const hz = b.hazard;
  const hazardHtml = hz
    ? `<h2>災害リスク（ハザードマップの想定）</h2>
      <p>${esc(hazardSummaryText(station.name_ja, hz))}</p>
      <ul>${HAZARD_KINDS.map(
        (kind) =>
          `<li><strong>${esc(kind.label)} ${esc(hz[kind.key].share_pct)}%</strong>（${esc(
            hazardAtStationText(kind, hz[kind.key])
          )}）: ${esc(hazardKindText(kind, hz[kind.key], hz.radius_m))}</li>`
      ).join("")}</ul>
      <ul>${HAZARD_NOTES.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      <p>${esc(HAZARD_SOURCE)}</p>`
    : "";
  const linesHtml =
    b.lines.length > 0
      ? `<h2>${esc(station.name_ja)}が乗っている路線</h2>
      <p>路線ごとに、このサイトで扱っている駅を住みやすさの順に並べています。</p>
      <ul>${b.lines.map((l) => `<li>${link(`/line/${l.slug}`, l.name)}</li>`).join("")}</ul>`
      : "";

  // 駅から近い施設（名前つき）と、県内・路線内の順位（StationPage.jsx と同じ文言関数。2026-09-30追加）
  const nearbyRows = nearbyFacilityRows(b.nearby_facilities);
  const nearbyFacilitiesHtml =
    nearbyRows.length > 0
      ? `<h2>${esc(station.name_ja)}から近い施設</h2>
      <p>${esc(nearbySummaryText(station.name_ja, b.nearby_facilities))}</p>
      <dl>${nearbyRows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`).join("")}</dl>
      <p>${esc(nearbyFacilitiesLead())}</p>`
      : "";
  const localTexts = [
    prefRankText(station.name_ja, b.pref_rank, b.default_walk_minutes),
    lineRankText(station.name_ja, b.line_ranks),
  ].filter(Boolean);
  const localHtml =
    localTexts.length > 0
      ? `<h2>${esc(localRankHeading(station.prefecture, b.line_ranks))}</h2>
      ${localTexts.map((t) => `<p>${esc(t)}</p>`).join("")}
      <p>${link(prefecturePath(station.prefecture, stations), `${station.prefecture}の駅をすべて見る`)}</p>`
      : "";

  const readTexts = [
    categoryReachText(b.category_reach, b.default_walk_minutes),
    concentrationText(b.concentration),
    nearestComparisonText(station.name_ja, b.nearest, b.default_walk_minutes),
  ].filter(Boolean);
  const readHtml =
    readTexts.length > 0
      ? `<h2>${esc(station.name_ja)}のデータの読み方</h2>${readTexts.map((t) => `<p>${esc(t)}</p>`).join("")}`
      : "";

  const similarHtml =
    b.similar_stations.length > 0
      ? `<h2>${esc(station.name_ja)}と施設の揃い方が似ている駅</h2>
      <p>${esc(similarLead(b.default_walk_minutes))}</p>
      <ul>${b.similar_stations
        .map(
          (item) =>
            `<li>${link(`/${item.slug}`, item.name_ja)}（${esc(item.prefecture ?? "")}）: ${esc(
              similarStationText(station.name_ja, item)
            )}</li>`
        )
        .join("")}</ul>`
      : "";

  // 駅同士を結ぶ内部リンク。トップの一覧しか経路が無い平たい構造を崩す狙い（nearbyStations.js参照）
  const nearby = findNearbyStations(station, stations);
  const nearbyHtml =
    nearby.length > 0
      ? `<h2>${esc(station.name_ja)}の近くの駅</h2>
      <ul>${nearby
        .map(({ station: s, km }) => `<li>${link(`/${s.slug}`, s.name_ja)}（約${esc(formatDistance(km))}）</li>`)
        .join("")}</ul>`
      : "";

  // 写真の1枚目と、全写真の帰属表示（CC BYの条件）
  const photo = b.photos[0];
  const photoHtml = photo
    ? `<figure><img src="${esc(photo.src)}" alt="${esc(photo.caption || station.name_ja)}" width="${esc(
        photo.width
      )}" height="${esc(photo.height)}" loading="lazy" /><figcaption>${esc(photo.caption)} ${esc(
        photoCredit(photo)
      )}</figcaption></figure>`
    : "";
  const creditHtml =
    b.photos.length > 0
      ? `<p>${esc(photoSourceText(b.photo_article, b.photo_source))}</p>
      <ul>${b.photos
        .map(
          (p) =>
            `<li><a href="${esc(p.page)}" target="_blank" rel="noreferrer">${esc(p.caption || "写真")}</a> — ${esc(
              photoCredit(p)
            )}</li>`
        )
        .join("")}</ul>`
      : "";

  return {
    title: stationTitle(station.name_ja),
    description: stationDescription(station.name_ja, main),
    canonicalPath: `/${station.slug}`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Place",
        name: station.name_ja,
        geo: { "@type": "GeoCoordinates", latitude: station.lat, longitude: station.lon },
        url: `${SITE_URL}/${station.slug}`,
        ...(photo ? { image: photo.src } : {}),
      },
      // 検索結果に「住みやすさ駅前スコア > 池袋駅」の形で階層が出るようにする
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: station.prefecture, item: `${SITE_URL}${prefecturePath(station.prefecture, stations)}` },
          { "@type": "ListItem", position: 3, name: station.name_ja },
        ],
      },
    ],
    body: `<main>
      <p>${link(prefecturePath(station.prefecture, stations), station.prefecture)}・${esc(station.kana ?? "")}</p>
      <h1>${esc(station.name_ja)}の住みやすさ駅前スコア</h1>
      ${photoHtml}
      <p>${esc(summaryText(station.name_ja, main))}</p>
      <h2>6分野の評価（徒歩分数別）</h2>
      <p>駅から半径${esc(main.radius_m)}m（徒歩1分=80m）以内の施設を数え、施設ごとに全国${esc(
        main.of
      )}駅の中での位置を出して、分野ごとに平均しています。総合点は6分野の点の平均です。</p>
      <table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${totalRow}${domainRows}</tbody>
      </table>
      <h2>施設の数（徒歩分数別）</h2>
      <table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      ${nearbyFacilitiesHtml}
      ${localHtml}
      ${publicHtml}
      ${hazardHtml}
      ${linesHtml}
      ${readHtml}
      ${similarHtml}
      ${nearbyHtml}
      <h2>データと写真について</h2>
      <p>施設の数はOpenStreetMapのデータに基づく目安です。実際の店舗数と異なる場合があります（更新: ${esc(
        b.updated_at
      )}）。</p>
      ${creditHtml}
      <p>${link("/", `全${stations.length}駅の一覧を見る`)} ／ ${link("/search", "条件で駅を探す")} ／ ${link(
        "/compare",
        "他の駅と比較する"
      )}</p>
    </main>
    ${siteFooterHtml(`/${station.slug}`)}`,
  };
}

// --- sitemap ----------------------------------------------------------------

function writeSitemap(paths) {
  const body = paths
    .map((p) => `  <url>\n    <loc>${SITE_URL}${p}</loc>\n  </url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), xml);
}

// --- 生成 -------------------------------------------------------------------

const sitemapPaths = ["/"];

writePage(topPage());

let stationCount = 0;
let skipped = 0;
for (const station of stations) {
  const page = stationPage(station);
  // 集計データがまだ無い駅はページとして成立しないのでsitemapにも載せない
  if (!page) {
    skipped++;
    continue;
  }
  writePage(page);
  sitemapPaths.push(page.canonicalPath);
  stationCount++;
}

// 固定ページ。
//
// 以前はtitle/canonicalと説明文1行しか出しておらず、GuidePage.jsx等に書いた本文が
// 静的HTMLに1文字も含まれていなかった（/guideの本文は48文字）。JSを実行しない
// クローラや審査ボットからは読み物が皆無のサイトに見えるため、
// content/pages.js のブロックからReact側と同じ本文を組む。
const STATIC_PAGE_BLOCKS = {
  "/search": () => SEARCH_BLOCKS,
  "/guide": () => GUIDE_BLOCKS,
  "/compare": () => COMPARE_BLOCKS,
  "/contact": () => CONTACT_BLOCKS,
  "/contact-received": () => CONTACT_RECEIVED_BLOCKS,
  "/about": () => [...ABOUT_BLOCKS, ...contactBlocks()],
  "/privacy": () => [...PRIVACY_BLOCKS, ...contactBlocks()],
};

const STATIC_PAGE_LEAD = {
  "/search": searchPageHtml,
};

// お問い合わせフォーム。項目の定義は content/pages.js が持ち、
// components/ContentBlocks.jsx の ContactForm と同じ内容を文字列で組む。
function contactFormHtml() {
  const hidden = CONTACT_FORM_HIDDEN.map(
    (h) => `<input type="hidden" name="${esc(h.name)}" value="${esc(h.value)}" />`
  ).join("");

  const fields = CONTACT_FORM_FIELDS.map((field) => {
    const required = field.required ? " required" : "";
    const placeholder = field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : "";
    let control;
    if (field.kind === "select") {
      const options = field.options
        .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
        .join("");
      control = `<select name="${esc(field.name)}"${required}>${options}</select>`;
    } else if (field.kind === "textarea") {
      control = `<textarea name="${esc(field.name)}" rows="${esc(field.rows)}"${required}${placeholder}></textarea>`;
    } else {
      control = `<input type="${esc(field.kind)}" name="${esc(field.name)}"${required}${placeholder} />`;
    }
    const hint = field.hint ? `<em>${esc(field.hint)}</em>` : "";
    return `<label><span>${esc(field.label)}${hint}</span>${control}</label>`;
  }).join("");

  return (
    `<form class="contact-form" action="${esc(CONTACT_FORM_ENDPOINT)}" method="POST">` +
    hidden +
    // ボット除け。人間には見えない欄で、埋まっていたら送信を捨てる
    `<input type="text" name="_honey" style="display:none" tabindex="-1" autocomplete="off" />` +
    fields +
    `<button type="submit">送信する</button>` +
    `</form>`
  );
}

// content/pages.js のブロックをHTMLにする。
// components/ContentBlocks.jsx と同じ型を扱うこと（片方だけ足すと中身がズレる）
function blocksToHtml(blocks) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "h2":
          return `<h2>${esc(block.text)}</h2>`;
        case "p":
          return `<p>${esc(block.text)}</p>`;
        case "ul":
          return `<ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
        case "qa":
          return `<p><strong>${esc(block.q)}</strong><br />${esc(block.a)}</p>`;
        case "link":
          return `<p>${block.note ? `${esc(block.note)} ` : ""}<a href="${esc(block.href)}" target="_blank" rel="noreferrer">${esc(block.text)}</a></p>`;
        // サイト内リンク。target="_blank" を付けないこと（同じタブで遷移させる）
        case "internalLink":
          return `<p>${link(block.href, block.text)}</p>`;
        case "contactForm":
          return contactFormHtml();
        default:
          return "";
      }
    })
    .join("");
}

for (const p of STATIC_PAGES) {
  const blocks = STATIC_PAGE_BLOCKS[p.path]?.() ?? [];
  const bodyHtml = blocks.length > 0 ? blocksToHtml(blocks) : `<p>${esc(p.description)}</p>`;
  // 解説の前に置く、そのページ固有の中身（データから組むもの）
  const leadHtml = STATIC_PAGE_LEAD[p.path]?.() ?? "";
  writePage({
    title: p.title,
    description: p.description,
    canonicalPath: p.path,
    noindex: p.noindex,
    body: `<main><h1>${esc(p.heading)}</h1>${leadHtml}${bodyHtml}</main>
    ${siteFooterHtml(p.path)}`,
  });
  // noindex のページは sitemap にも載せない（載せておいて検索避けするのは矛盾している）
  if (!p.noindex) sitemapPaths.push(p.path);
}

// 路線ページ・記事とその一覧（scripts/contentDocs.js）
for (const doc of DOCS) {
  const breadcrumb = [{ "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` }];
  if (doc.kind !== "index") {
    const parent = { line: "/lines", article: "/articles", pref: "/prefectures" }[doc.kind];
    breadcrumb.push({ "@type": "ListItem", position: 2, name: doc.kicker, item: `${SITE_URL}${parent}` });
  }
  breadcrumb.push({ "@type": "ListItem", position: breadcrumb.length + 1, name: doc.heading });
  writePage({
    title: doc.title,
    description: doc.description,
    canonicalPath: doc.path,
    jsonLd: [
      doc.kind === "article"
        ? { "@context": "https://schema.org", "@type": "Article", headline: doc.heading, description: doc.description }
        : { "@context": "https://schema.org", "@type": "WebPage", name: doc.heading, description: doc.description },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: breadcrumb },
    ],
    body: `<main><p>${esc(doc.kicker)}</p><h1>${esc(doc.heading)}</h1><p>${esc(doc.lead)}</p>${doc.html}</main>
    ${siteFooterHtml(doc.path)}`,
  });
  sitemapPaths.push(doc.path);
}

writeSitemap(sitemapPaths);

// --- 生成物の自己点検 -------------------------------------------------------
//
// このアプリはAdSenseの「有用性の低いコンテンツ」で2回不承認になっている。
// どちらも原因は同じ形だった: React側には書いてあるのに、プリレンダした静的HTMLには
// 出ていない。JSを実行しないクローラや審査ボットからは存在しないのと同じになる。
//
//   1回目（2026-08-08）: /guide・/privacy の本文がJSXに直書きで、静的HTMLの本文が48文字
//   2回目（2026-08-22）: components/Footer.jsx のリンクが静的HTMLに1本も出ておらず、
//                        駅ページ349枚から運営者情報・プライバシーポリシーへ到達できなかった
//
// 人が毎回目視するのは続かないので、ビルドを落とす形で機械に見張らせる。
// チェックを外さないこと。
function verifyOutput() {
  const errors = [];
  // 路線ページ・記事は dist/line/・dist/article/ の下にあるので、下の階層まで見る
  const files = fs
    .readdirSync(DIST, { recursive: true })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".html") && !f.startsWith("api/"));

  // 審査でもクロールでも、この3つへ到達できることが要件になる
  const REQUIRED_LINKS = ["/about", "/privacy", "/contact"];

  for (const file of files) {
    const html = fs.readFileSync(path.join(DIST, file), "utf-8");
    // dist/index.html はViteが吐いた素のテンプレートではなくトップページに差し替え済み
    const isPrerendered = html.includes("<main>");
    if (!isPrerendered) continue;

    const currentPath = file === "index.html" ? "/" : `/${file.replace(/.html$/, "")}`;

    if (!html.includes("<footer>")) {
      errors.push(`${file}: 共通フッターが出力されていない`);
      continue;
    }
    for (const required of REQUIRED_LINKS) {
      // 自分自身へのリンクはフッターから外しているので、そのページだけは免除する
      if (currentPath === required) continue;
      if (!html.includes(`href="${required}"`)) {
        errors.push(`${file}: ${required} へのリンクが無い`);
      }
    }
    // ODbLライセンスが全ページでの出典表示を要求している（CLAUDE.md参照）
    if (!html.includes("OpenStreetMap contributors")) {
      errors.push(`${file}: OpenStreetMapの出典表示が無い`);
    }
  }

  // お問い合わせフォームは1ページに集約している。無くなっていたら問い合わせ手段が消える
  const contactHtml = path.join(DIST, "contact.html");
  if (!fs.existsSync(contactHtml)) {
    errors.push("contact.html が生成されていない");
  } else if (!fs.readFileSync(contactHtml, "utf-8").includes("<form")) {
    errors.push("contact.html にフォームが出力されていない");
  }

  // 路線ページ・記事の一覧が無ければ、データ（station-lines.json）の読み込みに失敗している
  for (const required of ["lines.html", "articles.html", "prefectures.html"]) {
    if (!files.includes(required)) errors.push(`${required} が生成されていない`);
  }

  // 全駅のページに、トップ → 都道府県の一覧 → 都道府県ページ の順でたどり着けること（2026-09-30追加）。
  // 1,856駅に増やしたときにトップから全駅へ直接張るのをやめたので、道が途切れていないかを見張る
  const hubHtml = files
    .filter((f) => f === "index.html" || f === "prefectures.html" || f.startsWith("pref/"))
    .map((f) => fs.readFileSync(path.join(DIST, f), "utf-8"))
    .join("");
  const unreachable = [...bundles.keys()].filter((slug) => !hubHtml.includes(`href="/${slug}"`));
  if (unreachable.length > 0) {
    errors.push(`都道府県ページからたどれない駅が${unreachable.length}駅ある: ${unreachable.slice(0, 10).join(", ")}`);
  }

  if (errors.length > 0) {
    console.error(`
生成物の点検で ${errors.length} 件の問題が見つかりました:`);
    for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
    if (errors.length > 20) console.error(`  ... 他 ${errors.length - 20} 件`);
    process.exit(1);
  }
  console.log(`生成物を点検しました（${files.length}ファイル、問題なし）`);
}

verifyOutput();

console.log(
  `静的HTMLを生成しました（駅${stationCount}ページ + 路線・記事${DOCS.length}ページ + 固定${STATIC_PAGES.length + 1}ページ / データ未整備でスキップ ${skipped}駅、SITE_URL=${SITE_URL}）`
);
console.log(`sitemap.xml を生成しました（${sitemapPaths.length}件のURL）`);
