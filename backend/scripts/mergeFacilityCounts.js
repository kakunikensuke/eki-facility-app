/**
 * 分けて取った集計結果（batch/updateFacilityCounts.js --part k/n --out <file>）を
 * backend/data/facility-counts.json にまとめる（2026-09-29追加）。
 *
 *   node backend/scripts/mergeFacilityCounts.js <file1> <file2> ...
 *
 * 各ファイルに入っている駅だけを上書きし、入っていない駅は既存のデータを残す。
 */
const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "..", "data", "facility-counts.json");
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("使い方: node backend/scripts/mergeFacilityCounts.js <file1> <file2> ...");
  process.exit(1);
}

const merged = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
let updated = 0;
for (const file of files) {
  const part = JSON.parse(fs.readFileSync(file, "utf-8"));
  for (const [slug, record] of Object.entries(part)) {
    merged[slug] = record;
    updated++;
  }
}
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
console.log(`${updated}駅を更新しました -> ${OUTPUT_PATH}`);
