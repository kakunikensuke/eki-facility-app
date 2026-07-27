import { CATEGORIES } from "./categories";

// スコア算出時のtarget値(backend/scoring.jsのSCORE_TARGETSと一致させる規約)。
// フロント/バックエンドでビルドルートが分かれているため値を複製している。
const SCORE_TARGETS = {
  convenience_store: 27,
  supermarket: 8,
  hospital: 7,
  restaurant: 140,
};

// 駅ごとの実データから一言コメントを生成する(要件定義書10章の収益化準備の一環、
// AdSense審査対策として各駅ページの記述内容に差をつけるための機能)。
export function buildStationComment(stationName, data) {
  const ratios = CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    count: data.counts[cat.key] || 0,
    ratio: (data.counts[cat.key] || 0) / SCORE_TARGETS[cat.key],
  }));
  const strongest = [...ratios].sort((a, b) => b.ratio - a.ratio)[0];
  const weakest = [...ratios].sort((a, b) => a.ratio - b.ratio)[0];

  let scoreSentence;
  if (data.score.total >= 80) {
    scoreSentence = `${stationName}は徒歩${data.walk_minutes}分圏内の生活利便施設が非常に充実しているエリアです。`;
  } else if (data.score.total >= 50) {
    scoreSentence = `${stationName}は徒歩${data.walk_minutes}分圏内に生活に必要な施設が一通り揃っているエリアです。`;
  } else {
    scoreSentence = `${stationName}周辺は徒歩${data.walk_minutes}分圏内の店舗数が全国の駅と比べてやや少なめのエリアです。`;
  }

  let detailSentence = `特に${strongest.label}が${strongest.count}軒と充実している一方、${weakest.label}は${weakest.count}軒です。`;

  const extras = [];
  if ((data.counts.park || 0) >= 10) extras.push("公園も多く");
  if ((data.counts.nursery || 0) >= 5) extras.push("保育園・幼稚園も複数あり");
  const extraSentence =
    extras.length > 0 ? `${extras.join("、")}、子育て世帯にも参考になるエリアです。` : "";

  return [scoreSentence, detailSentence, extraSentence].filter(Boolean).join("");
}
