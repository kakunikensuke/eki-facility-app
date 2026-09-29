// 災害リスク（ハザードマップの想定）の表示用の定義と文章（2026-09-29追加）。
// データは backend/scripts/fetchHazard.js が作る backend/data/station-hazard.json。
// 駅ページ（StationPage.jsx）・静的HTML（prerender.js）・路線ページと記事（scripts/contentDocs.js）が
// すべてここの文言を使う。文章を画面側に直書きしないこと。

export const HAZARD_KINDS = [
  { key: "flood", label: "洪水", area: "洪水浸水想定区域（想定最大規模）", water: true },
  { key: "hightide", label: "高潮", area: "高潮浸水想定区域", water: true },
  { key: "tsunami", label: "津波", area: "津波浸水想定区域", water: true },
  { key: "landslide", label: "土砂災害", area: "土砂災害警戒区域", water: false },
];

export const DEPTH_LABELS = {
  lt05: "0.5m未満",
  "05to3": "0.5〜3m",
  "3to5": "3〜5m",
  gte5: "5m以上",
};

export const HAZARD_SOURCE =
  "出典: 「ハザードマップポータルサイト」（https://disaportal.gsi.go.jp/）のオープンデータを加工して作成";

// 画面に必ず添える注意書き（利用条件と、データが含まないもの）
export const HAZARD_NOTES = [
  "国や自治体が公表している「想定」を地図の色から読み取ったもので、実際の被害や安全を示すものではありません。",
  "洪水は国・都道府県が指定した川のものだけで、下水や水路があふれる内水氾濫は含みません。区域の外でも浸水しないとは限りません。",
  "住まいを決める前に、必ず市区町村のハザードマップで最新の情報を確かめてください。不動産取引の重要事項説明には使えません。",
];

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 徒歩10分圏に何かしらの区域がかかっているか */
export function hasAnyHazard(hz) {
  return HAZARD_KINDS.some((k) => hz[k.key].share_pct > 0);
}

/** カードの見出しの下に出す一行（駅の地点の状態） */
export function hazardAtStationText(kind, h) {
  if (kind.water) {
    return h.at_station ? `駅の地点: ${DEPTH_LABELS[h.at_station]}の想定` : "駅の地点: 区域外";
  }
  if (h.at_station === "special") return "駅の地点: 特別警戒区域";
  if (h.at_station === "warning") return "駅の地点: 警戒区域";
  return "駅の地点: 区域外";
}

/** 種類ごとの説明文（カードの本文） */
export function hazardKindText(kind, h, radiusM) {
  if (h.share_pct === 0) {
    return `徒歩${radiusM / 80}分圏内に${kind.area}はありません。`;
  }
  if (kind.water) {
    const deep = h.deep_share_pct > 0 ? `3m以上（2階の床まで届く目安）の場所は${fmt(h.deep_share_pct)}%です。` : "";
    return `徒歩${radiusM / 80}分圏内の${fmt(h.share_pct)}%が区域に入り、深い所で${DEPTH_LABELS[h.max]}の浸水が想定されています。${deep}`;
  }
  const special = h.special_share_pct > 0 ? `うち特別警戒区域は${fmt(h.special_share_pct)}%です。` : "特別警戒区域はありません。";
  return `徒歩${radiusM / 80}分圏内の${fmt(h.share_pct)}%が警戒区域です。${special}`;
}

/** 駅ページの冒頭に出すまとめ（1〜2文） */
export function hazardSummaryText(stationName, hz) {
  const walk = hz.radius_m / 80;
  if (!hasAnyHazard(hz)) {
    return `${stationName}の徒歩${walk}分圏内（半径${hz.radius_m}m）には、洪水・高潮・津波の浸水想定区域も土砂災害警戒区域もありません。ただし内水氾濫や、区域の指定がまだの川は含まれていません。`;
  }
  const parts = HAZARD_KINDS.filter((k) => hz[k.key].share_pct > 0).map(
    (k) => `${k.label}${fmt(hz[k.key].share_pct)}%`
  );
  const atStation = HAZARD_KINDS.filter((k) => hz[k.key].at_station).map((k) => k.label);
  const at =
    atStation.length > 0
      ? `駅の地点そのものも${atStation.join("・")}の区域に入っています。`
      : "駅の地点そのものは、どの区域にも入っていません。";
  return `${stationName}の徒歩${walk}分圏内（半径${hz.radius_m}m）で区域がかかっている割合は、${parts.join("・")}です。${at}`;
}
