/**
 * 駅のある市区町村に「どんな人が住んでいるか」を、国勢調査（2020年）と保育所等の待機児童の調査（2026年4月）から取り込み、
 * backend/data/station-people.json に書く（2026-09-30追加）。
 *
 * なぜ要るか: 駅ページの中身は施設・地価・家賃・災害で、「若い一人暮らしが多い街か、子育て世帯が多い街か」が
 * 分からなかった。どちらも国の統計で、市区町村（政令市は区）ごとに無料でそろう。
 *
 * 使う表（e-Stat の file-download?statInfId=<ID>&fileKind=0 で取れる xlsx。<国勢調査のフォルダ>/<ID>.xlsx に置く）:
 *   000032142402 令和2年国勢調査 人口等基本集計 第1-1表（人口、2015年の人口（組替）、5年間の人口増減率）
 *   000032142410 同 第2-7表（年齢5歳階級別人口、65歳以上の割合、平均年齢）
 *   000032142492 同 第8-1表（一般世帯数、世帯人員が1人の世帯、18歳未満・6歳未満の世帯員のいる世帯）
 * 待機児童: こども家庭庁「保育所等関連状況取りまとめ（令和8年4月1日）」の（参考）定員・申込者の状況（xlsx）の
 *   「申込者の状況」シート。市区町村ごと（政令市は市全体）。
 *   https://www.cfa.go.jp/policies/hoiku/torimatome/r8
 *
 * 駅 → 市区町村: importRent.js が保存した国土地理院の逆ジオコーダの結果（D:/ClaudeData/eki の gsi-muni*.json）を使う。
 * 先に importRent.js を流しておくこと（結果が無い駅があれば止まる）。
 * 表に無いとき（浜松市は2024年に区を再編し、2020年の区と合わない）は市全体の値を使う（level: city）。
 *
 * 実行:
 *   node backend/scripts/importCensus.js <国勢調査のフォルダ> <保育所等の定員・申込者の状況のxlsx> [--cache <フォルダ>]
 */

const fs = require("fs");
const path = require("path");
const { readSheetRows, designatedCityOf } = require("./rentTable");

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-people.json");
const TABLE_POPULATION = "000032142402";
const TABLE_AGE = "000032142410";
const TABLE_HOUSEHOLD = "000032142492";
const HOIKU_SHEET = 2; // 「申込者の状況」
const SOURCES = [
  "総務省「令和2年国勢調査 人口等基本集計」第1-1表・第2-7表・第8-1表（e-Stat）",
  "こども家庭庁「保育所等関連状況取りまとめ（令和8年4月1日）」",
];

const args = process.argv.slice(2);
const [censusDir, hoikuPath] = args;
if (!censusDir || !hoikuPath || hoikuPath.startsWith("--")) {
  console.error("使い方: node backend/scripts/importCensus.js <国勢調査のフォルダ> <保育所等の定員・申込者の状況のxlsx> [--cache <フォルダ>]");
  process.exit(1);
}
const cacheIdx = args.indexOf("--cache");
const CACHE_DIR = cacheIdx === -1 ? "D:/ClaudeData/eki" : args[cacheIdx + 1];

const num = (v) => (v === undefined || v === "" || v === "-" ? 0 : Number(v));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const stripNo = (s) => String(s ?? "").replace(/^\d+_/, "").trim();

// 第1-1表・第2-7表は2000年の旧市町村の行（地域識別コード 9）も持つので除く
function readPopulation(rows) {
  const out = new Map();
  for (const r of rows) {
    const code = r[5];
    if (!/^\d{5}$/.test(code ?? "") || r[0] === "9" || out.has(code)) continue;
    out.set(code, { name: stripNo(r[6]), population: num(r[7]), population_2015: num(r[10]) });
  }
  return out;
}

function readAge(rows) {
  const labels = rows.find((r) => r?.includes("00_総数"));
  const col = (label) => labels.indexOf(label);
  const total = col("00_総数");
  const unknown = col("22_年齢「不詳」");
  const young = ["05_20～24歳", "06_25～29歳", "07_30～34歳", "08_35～39歳"].map(col);
  const senior = col("R3_（再掲）65歳以上");
  // 平均年齢は後ろから2列目（最後は年齢中位数）
  const avgAge = labels.length - 2;
  const out = new Map();
  for (const r of rows) {
    if (r?.[0] !== "0_国籍総数" || r[1] !== "0_総数" || r[2] === "9") continue;
    const code = r[7];
    if (!/^\d{5}$/.test(code ?? "") || out.has(code)) continue;
    const known = num(r[total]) - num(r[unknown]);
    out.set(code, {
      young_pct: pct(young.reduce((s, c) => s + num(r[c]), 0), known),
      senior_pct: pct(num(r[senior]), known),
      avg_age: Math.round(num(r[avgAge]) * 10) / 10,
    });
  }
  return out;
}

function readHouseholds(rows) {
  const out = new Map();
  for (const r of rows) {
    const code = String(r[2] ?? "").slice(0, 5);
    if (!/^\d{5}$/.test(code)) continue;
    const h = out.get(code) ?? {};
    if (r[3] === "0_総数") Object.assign(h, { households: num(r[4]), single: num(r[5]) });
    else if (r[3]?.startsWith("1_")) h.under6 = num(r[4]);
    else if (r[3]?.startsWith("2_")) h.under18 = num(r[4]);
    out.set(code, h);
  }
  return out;
}

// 待機児童: 「都道府県名＋市区町村名」→ 値。政令市は市全体の1行
function readChildcare(rows) {
  const labels = rows.find((r) => r?.includes("待機児童"));
  const waiting = labels.indexOf("待機児童");
  const applicants = labels.findIndex((c) => c?.startsWith("申込者数"));
  const specific = labels.findIndex((c) => c?.startsWith("特定の保育園等のみ希望している者"));
  const out = new Map();
  for (const r of rows) {
    if (!r?.[2] || !r[3] || r[2] === labels[2]) continue;
    out.set(`${r[2]}${r[3]}`, {
      area: r[3],
      applicants: num(r[applicants]),
      waiting: num(r[waiting]),
      specific_only: num(r[specific]),
    });
  }
  return out;
}

function main() {
  const readTable = (id) => readSheetRows(path.join(censusDir, `${id}.xlsx`));
  const population = readPopulation(readTable(TABLE_POPULATION));
  const age = readAge(readTable(TABLE_AGE));
  const households = readHouseholds(readTable(TABLE_HOUSEHOLD));
  const childcare = readChildcare(readSheetRows(hoikuPath, HOIKU_SHEET));
  const totalWaiting = [...childcare.values()].reduce((s, c) => s + c.waiting, 0);
  console.log(`国勢調査: 人口 ${population.size}件 / 年齢 ${age.size}件 / 世帯 ${households.size}件、待機児童の表: ${childcare.size}市区町村（合計 ${totalWaiting}人）`);

  const profileOf = (code) => {
    const p = population.get(code);
    const a = age.get(code);
    const h = households.get(code);
    if (!p || !a || !h?.households) return null;
    return {
      population: p.population,
      pop_change_pct: p.population_2015 ? Math.round((p.population / p.population_2015 - 1) * 1000) / 10 : null,
      young_pct: a.young_pct,
      senior_pct: a.senior_pct,
      avg_age: a.avg_age,
      single_pct: pct(h.single, h.households),
      kids_pct: pct(h.under18, h.households),
      under6_pct: pct(h.under6, h.households),
    };
  };

  const cache = {};
  for (const f of ["gsi-muni.json", "gsi-muni-station.json"]) {
    const p = path.join(CACHE_DIR, f);
    if (fs.existsSync(p)) Object.assign(cache, JSON.parse(fs.readFileSync(p, "utf-8")));
  }
  const prefNames = new Map([...population].filter(([code]) => code.endsWith("000")).map(([code, p]) => [code, p.name]));

  const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
  const out = {};
  const levels = {};
  const missing = [];
  let childcareHits = 0;
  for (const s of stations) {
    const raw = cache[`${s.lat.toFixed(4)},${s.lon.toFixed(4)}`];
    if (!raw) {
      missing.push(s.slug);
      continue;
    }
    const code = raw.padStart(5, "0");
    const cityCode = designatedCityOf(code, (c) => population.get(c)?.name.endsWith("市"));
    const prefCode = `${code.slice(0, 2)}000`;
    const hit =
      (profileOf(code) && { code, level: "municipality" }) ||
      (cityCode && profileOf(cityCode) && { code: cityCode, level: "city" }) ||
      null;
    if (!hit) {
      missing.push(s.slug);
      continue;
    }
    // 待機児童は市区町村の行、政令市の区なら市全体の行
    const pref = prefNames.get(prefCode);
    const cityName = population.get(cityCode)?.name;
    const care =
      childcare.get(`${pref}${population.get(hit.code).name}`) ??
      (cityName && childcare.get(`${pref}${cityName}`)) ??
      null;
    if (care) childcareHits++;
    out[s.slug] = {
      code: hit.code,
      area: population.get(hit.code).name,
      level: hit.level,
      ...profileOf(hit.code),
      childcare: care,
    };
    levels[hit.level] = (levels[hit.level] ?? 0) + 1;
  }
  if (missing.length) {
    console.error(`市区町村が分からない駅があります（先に importRent.js を流す）: ${missing.join(", ")}`);
    process.exit(1);
  }

  const prefectures = Object.fromEntries([...prefNames].map(([code, name]) => [name, profileOf(code)]));
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        sources: SOURCES,
        census_year: 2020,
        childcare_date: "2026-04-01",
        // 全国で待機児童のいる市区町村の数（駅ページの「入りにくい方か」の説明に使う）
        childcare_summary: {
          municipalities: childcare.size,
          with_waiting: [...childcare.values()].filter((c) => c.waiting > 0).length,
          total_waiting: totalWaiting,
        },
        national: profileOf("00000"),
        prefectures,
        stations: out,
      },
      null,
      1
    ) + "\n"
  );
  console.log(`station-people.json を書き出しました（${Object.keys(out).length}/${stations.length}駅、${JSON.stringify(levels)}、待機児童の行が見つかった駅 ${childcareHits}）`);
}

main();
