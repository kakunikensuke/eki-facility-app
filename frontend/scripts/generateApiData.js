// APIの応答を静的JSONとして書き出す（出力先: frontend/public/api/）。
//
// なぜ必要か（2026-08-15）:
// バックエンド（backend/server.js）は動的な処理を一切していない。リポジトリ内の
// 静的JSONを読んで決まった計算を返すだけで、書き込みも認証も無く、データが変わるのは
// 1日1回のGitHub Actionsのときだけ。それをRenderの常時起動サービスで賄っていたため、
// 無料枠を圧迫していた。ビルド時に全部JSONとして出しておけば、Cloudflare Pagesが配信できる。
//
// 2026-09-29、中身の組み立てを scripts/stationBundle.js に移した（プリレンダと同じ物を使うため）。
// ここは書き出すだけ。backend/server.js は旧スコアのまま残っているが、本番では使っていない。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadData, buildAll } from "./stationBundle.js";
import { buildDocs } from "./contentDocs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "api");

function writeJson(relativePath, value) {
  const outPath = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(value));
}

// 生成物は毎回作り直す。駅を減らしたときに古いJSONが残ると、
// 一覧に無い駅のページだけ生き続けることになる
fs.rmSync(OUT_DIR, { recursive: true, force: true });

const data = loadData();
const { bundles, matrix, photosLite, scores } = buildAll(data);

// 駅一覧。lat/lonは「近くの駅」、kana・prefectureは読みでの検索と都道府県別の一覧に使う
writeJson(
  "stations.json",
  data.stations.map(({ slug, name_ja, kana, prefecture, lat, lon }) => ({
    slug,
    name_ja,
    kana,
    prefecture,
    lat,
    lon,
  }))
);

writeJson("station-scores.json", { walk_minutes: matrix.default_walk_minutes, stations: scores });
writeJson("station-matrix.json", matrix);
writeJson("station-photos-lite.json", photosLite);

for (const bundle of bundles.values()) {
  writeJson(`facility-counts/${bundle.slug}.json`, bundle);
}

// 路線ページ・記事（scripts/contentDocs.js）。本文HTMLはプリレンダと同じ物
const { docs, nav } = buildDocs(bundles, data.stationLines);
for (const doc of docs) {
  const { path: docPath, title, description, heading, kicker, lead, html } = doc;
  writeJson(`docs/${doc.kind}/${doc.slug}.json`, { path: docPath, title, description, heading, kicker, lead, html });
}
writeJson("docs/nav.json", nav);

console.log(
  `APIの静的JSONを生成しました（駅${bundles.size}件 + 一覧4件 + 路線・記事${docs.length}件 / データ未整備でスキップ ${
    data.stations.length - bundles.size
  }駅、写真あり ${Object.keys(photosLite).length}駅、出力先 public/api/）`
);
