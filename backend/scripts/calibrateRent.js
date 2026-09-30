/**
 * 家賃の目安の補正倍率を都道府県ごとに出し、backend/data/rent-factors.json に書く（2026-09-30追加）。
 *
 * 家賃の目安の元（住宅・土地統計調査の民営借家の1m²当たり家賃×25m²）は、古い物件も含む借家全体の
 * 2023年の平均なので、募集中の物件の家賃より低く出る。その差を2つの公表資料で埋める
 * （元データは backend/data/rent-calibration-inputs.json。どちらも公表資料の画像から書き写した）。
 *
 * - 募集家賃（アットホーム、13エリア、30m²以下）: 差の「全体の大きさ」を決める
 * - 成約家賃（全国家賃動向、47都道府県、1部屋、3か月平均）: 都道府県ごとの「差の違い」を決める
 *
 * 倍率の出し方（13エリアでの1つ抜き検証の平均誤差で選んだ。実行時に出力する）:
 *   一定倍率 F      = 13エリアの「募集家賃 ÷ 統計×25m²」の中央値
 *   都道府県の倍率 = k × 県の成約家賃 ÷（県の統計×25m²）。k は13エリアで募集家賃に合わせる係数
 *   採用する倍率   = (1 − W) × F + W × 都道府県の倍率（W = BLEND_WEIGHT）
 * 一定倍率だけ（誤差10.0%）や都道府県の倍率だけ（11.5%）より、半々に混ぜたもの（7.9%）が良かった。
 * 成約家賃の1部屋には1DK・1LDKも入り、地方ほど広い部屋が多いとみられるので、県の倍率をそのまま使うと地方で高く出すぎる。
 *
 * 実行:
 *   node backend/scripts/calibrateRent.js <第122-4表のxlsx>
 */

const fs = require("fs");
const path = require("path");
const { readSheetRows, rentByCode } = require("./rentTable");

const INPUTS_PATH = path.join(__dirname, "..", "data", "rent-calibration-inputs.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "rent-factors.json");
const ROOM_M2 = 25; // frontend/src/stationProfileText.js の RENT_ROOM_M2 と同じ
const BLEND_WEIGHT = 0.5;
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const round2 = (v) => Math.round(v * 100) / 100;

function main() {
  const xlsx = process.argv[2];
  if (!xlsx) {
    console.error("使い方: node backend/scripts/calibrateRent.js <第122-4表のxlsx>");
    process.exit(1);
  }
  const rents = rentByCode(readSheetRows(xlsx));
  const inputs = JSON.parse(fs.readFileSync(INPUTS_PATH, "utf-8"));

  // 地域コード（"13000-13100" は東京都から特別区部を戸数で差し引いたもの）→ 1m²当たり家賃
  const statOf = (code) => {
    const [a, b] = code.split("-");
    if (!b) return rents.get(a).yen_per_m2;
    const x = rents.get(a);
    const y = rents.get(b);
    return (x.units * x.yen_per_m2 - y.units * y.yen_per_m2) / (x.units - y.units);
  };
  const prefStat = Object.fromEntries(
    PREFECTURES.map((p, i) => [p, rents.get(`${String(i + 1).padStart(2, "0")}000`).yen_per_m2])
  );
  // 成約家賃は月ごとのぶれが大きい（奈良県・大分県は1割近く動く）ので平均する
  const contract = Object.fromEntries(
    PREFECTURES.map((p) => [p, mean(inputs.contract.months.map((m) => m.values[p]))])
  );
  const prefRatio = Object.fromEntries(PREFECTURES.map((p) => [p, contract[p] / (prefStat[p] * ROOM_M2)]));

  const areas = inputs.asking.areas.map(([name, mansion, apart, code, pref]) => ({
    name,
    pref,
    market: (mansion + apart) / 2,
    est: statOf(code) * ROOM_M2,
  }));
  const fitConstant = (pts) => median(pts.map((p) => p.market / p.est));
  const fitK = (pts) => median(pts.map((p) => p.market / (p.est * prefRatio[p.pref])));
  const factorOf = (F, k, pref, w) => (1 - w) * F + w * k * prefRatio[pref];

  // 1つ抜き検証（そのエリアを除いて F と k を出し、そのエリアを当てる）
  const loo = (w) =>
    mean(
      areas.map((p, i) => {
        const rest = areas.filter((_, j) => j !== i);
        return Math.abs((p.est * factorOf(fitConstant(rest), fitK(rest), p.pref, w)) / p.market - 1);
      })
    );
  const F = fitConstant(areas);
  const k = fitK(areas);
  const errors = { constant: loo(0), prefecture: loo(1), blended: loo(BLEND_WEIGHT) };

  const factors = Object.fromEntries(PREFECTURES.map((p) => [p, round2(factorOf(F, k, p, BLEND_WEIGHT))]));
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        method: `(1 − ${BLEND_WEIGHT}) × 一定倍率 + ${BLEND_WEIGHT} × 都道府県の倍率`,
        constant: round2(F),
        k: round2(k),
        blend_weight: BLEND_WEIGHT,
        loo_error_pct: Object.fromEntries(Object.entries(errors).map(([key, v]) => [key, Math.round(v * 1000) / 10])),
        sources: [inputs.asking.source, inputs.contract.source],
        factors,
      },
      null,
      1
    ) + "\n"
  );
  const sorted = Object.entries(factors).sort((a, b) => a[1] - b[1]);
  console.log(`一定倍率 ${F.toFixed(3)} / k ${k.toFixed(3)}`);
  console.log(
    `13エリアでの1つ抜き検証の平均誤差: 一定倍率 ${(errors.constant * 100).toFixed(1)}% / 都道府県の倍率 ${(errors.prefecture * 100).toFixed(1)}% / 混ぜたもの ${(errors.blended * 100).toFixed(1)}%`
  );
  console.log(`都道府県の倍率: ${sorted[0][0]} ${sorted[0][1]} 〜 ${sorted[sorted.length - 1][0]} ${sorted[sorted.length - 1][1]}`);
  console.log(`rent-factors.json を書き出しました -> ${OUTPUT_PATH}`);
}

main();
