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
import { createRequire } from "module";
import { CATEGORIES, EXTRA_CATEGORIES } from "../src/categories.js";
import { buildStationComment } from "../src/stationComment.js";
import { getStationTags } from "../src/stationTags.js";
import { findNearbyStations, formatDistance } from "../src/nearbyStations.js";
import {
  SITE_NAME,
  topTitle,
  topDescription,
  stationTitle,
  stationDescription,
  STATIC_PAGES,
} from "../src/pageMeta.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// スコア計算・タグ判定・レコード正規化はバックエンドの実装をそのまま使う
// （target値やしきい値を三重に複製しないため）
const { calculateScore, SCORE_TARGETS_BY_WALK_MINUTES } = require("../../backend/scoring.js");
const {
  getStationTagKeys,
  TAG_THRESHOLDS_BY_WALK_MINUTES,
} = require("../../backend/stationTags.js");
const { normalizeRecord, DEFAULT_WALK_MINUTES } = require("../../backend/facilityRecord.js");
const { buildStationScores } = require("../../backend/stationScores.js");

// デプロイ先が1つしかないので既定値を本番URLにしている（Cloudflare Pages側の
// 環境変数設定を増やさずに済ませるため）。別ドメインで使う場合のみ環境変数で上書きする。
const SITE_URL = process.env.VITE_SITE_URL || "https://eki.kakuni-lab.com";
const DIST = path.join(__dirname, "..", "dist");
const DATA_DIR = path.join(__dirname, "..", "..", "backend", "data");

const stations = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "stations.json"), "utf-8"));
const facilityCounts = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "facility-counts.json"), "utf-8")
);

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

function metaTags({ title, description, canonicalPath, jsonLd }) {
  const url = `${SITE_URL}${canonicalPath}`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
  ];
  // jsonLdは単体でも配列でも受ける（駅ページはPlaceとBreadcrumbListの2つを出す）
  for (const item of [].concat(jsonLd ?? [])) {
    tags.push(`<script type="application/ld+json">${JSON.stringify(item)}</script>`);
  }
  return tags.map((tag) => `    ${tag}`).join("\n");
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

// 全駅への内部リンク一覧。クローラが349駅を発見できる唯一の経路なので必ず出す
// （アプリ本体は<select>での遷移しか持たず、駅ページへのaタグが存在しない）
function stationIndexList() {
  return stations
    .map((s) => `<li>${link(`/${s.slug}`, s.name_ja)}</li>`)
    .join("");
}

// トップのランキング。件数はTopPage.jsxのRANKING_LIMITと揃える規約
const RANKING_LIMIT = 20;

function topPage() {
  const description = topDescription(stations.length);
  const ranking = buildStationScores(stations, facilityCounts).slice(0, RANKING_LIMIT);
  const rankingHtml =
    ranking.length > 0
      ? `<h2>駅前スコアの高い駅 TOP${ranking.length}（徒歩${DEFAULT_WALK_MINUTES}分圏内）</h2>
      <ol>${ranking
        .map(
          (s) =>
            `<li>${link(`/${s.slug}`, s.name_ja)}（${esc(s.score)}点・合計${esc(s.total_count)}軒）</li>`
        )
        .join("")}</ol>`
      : "";

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
      <h1>住みやすさ駅前スコア</h1>
      <p>${esc(description)}</p>
      ${rankingHtml}
      <h2>対応駅一覧（${stations.length}駅）</h2>
      <ul>${stationIndexList()}</ul>
      <p>${link("/compare", "駅を比較する")} ／ ${link("/guide", "スコアの見方")}</p>
    </main>`,
  };
}

// APIが返すのと同じ形の1段階ぶんのデータを組み立てる（stationComment等が同じ形を期待するため）
function buildTier(record, walkMinutes) {
  const raw = record.tiers[walkMinutes];
  if (!raw) return null;
  return {
    walk_minutes: Number(walkMinutes),
    radius_m: raw.radius_m,
    counts: raw.counts,
    score: calculateScore(raw.counts, Number(walkMinutes)),
    targets: SCORE_TARGETS_BY_WALK_MINUTES[walkMinutes],
    tag_keys: getStationTagKeys(raw.counts, Number(walkMinutes)),
    tag_thresholds: TAG_THRESHOLDS_BY_WALK_MINUTES[walkMinutes],
  };
}

function stationPage(station) {
  const raw = facilityCounts[station.slug];
  if (!raw) return null;

  const record = normalizeRecord(raw);
  const availableMinutes = Object.keys(record.tiers)
    .map(Number)
    .sort((a, b) => a - b);
  const tiers = availableMinutes.map((m) => buildTier(record, m)).filter(Boolean);
  if (tiers.length === 0) return null;

  // 見出し・description・一言コメントは既定の段階を基準にする（無ければ最小の段階）
  const mainTier = tiers.find((t) => t.walk_minutes === DEFAULT_WALK_MINUTES) ?? tiers[0];
  const comment = buildStationComment(station.name_ja, mainTier);
  const tags = getStationTags(mainTier.tag_keys);
  const totalCount = CATEGORIES.reduce((sum, cat) => sum + (mainTier.counts[cat.key] || 0), 0);

  const description = stationDescription(station.name_ja, mainTier);

  // 4段階すべての軒数を1つの表に出す。段階の切り替えはJS側のタブだが、
  // クローラにも全段階の数字が見えるようにしておく（1ページの情報量を増やす狙いもある）
  const headerCells = tiers.map((t) => `<th>徒歩${esc(t.walk_minutes)}分</th>`).join("");
  const rows = [...CATEGORIES, ...EXTRA_CATEGORIES]
    .map((cat) => {
      const cells = tiers.map((t) => `<td>${esc(t.counts[cat.key] || 0)}軒</td>`).join("");
      return `<tr><td>${esc(cat.label)}</td>${cells}</tr>`;
    })
    .join("");
  const scoreRow = tiers.map((t) => `<td>${esc(t.score.total)}点</td>`).join("");

  const tagHtml = tags.length > 0
    ? `<p>${tags.map((t) => esc(t.label)).join(" / ")}</p>`
    : "";

  // 駅同士を結ぶ内部リンク。トップの一覧しか経路が無い平たい構造を崩す狙い（nearbyStations.js参照）
  const nearby = findNearbyStations(station, stations);
  const nearbyHtml =
    nearby.length > 0
      ? `<h2>${esc(station.name_ja)}の近くの駅</h2>
      <ul>${nearby
        .map(
          ({ station: s, km }) =>
            `<li>${link(`/${s.slug}`, s.name_ja)}（約${esc(formatDistance(km))}）</li>`
        )
        .join("")}</ul>`
      : "";

  return {
    title: stationTitle(station.name_ja),
    description,
    canonicalPath: `/${station.slug}`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Place",
        name: station.name_ja,
        geo: { "@type": "GeoCoordinates", latitude: station.lat, longitude: station.lon },
        url: `${SITE_URL}/${station.slug}`,
      },
      // 検索結果に「住みやすさ駅前スコア > 池袋駅」の形で階層が出るようにする
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: station.name_ja },
        ],
      },
    ],
    body: `<main>
      <h1>${esc(station.name_ja)}の住みやすさ駅前スコア</h1>
      <p>スコア ${mainTier.score.total} 点／徒歩${esc(mainTier.walk_minutes)}分圏内の合計 ${totalCount} 軒</p>
      <p>${esc(comment)}</p>
      ${tagHtml}
      <h2>徒歩分数別の施設数</h2>
      <table>
        <thead><tr><th>カテゴリ</th>${headerCells}</tr></thead>
        <tbody><tr><td>住みやすさスコア</td>${scoreRow}</tr>${rows}</tbody>
      </table>
      <p>店舗数はOpenStreetMapのデータに基づく目安です（更新: ${esc(record.updated_at)}）。</p>
      ${nearbyHtml}
      <p>${link("/", `全${stations.length}駅の一覧を見る`)} ／ ${link("/compare", "他の駅と比較する")}</p>
    </main>`,
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

// 固定ページ。中身はJS側で描画されるが、少なくとも固有のtitle/canonicalは持たせておく
for (const p of STATIC_PAGES) {
  writePage({
    title: p.title,
    description: p.description,
    canonicalPath: p.path,
    body: `<main><h1>${esc(p.heading)}</h1><p>${esc(p.description)}</p><p>${link("/", "駅一覧に戻る")}</p></main>`,
  });
  sitemapPaths.push(p.path);
}

writeSitemap(sitemapPaths);

console.log(
  `静的HTMLを生成しました（駅${stationCount}ページ + 固定${STATIC_PAGES.length + 1}ページ / データ未整備でスキップ ${skipped}駅、SITE_URL=${SITE_URL}）`
);
console.log(`sitemap.xml を生成しました（${sitemapPaths.length}件のURL）`);
