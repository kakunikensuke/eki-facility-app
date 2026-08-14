// 駅ごとの順位・施設の広がり方を文章にする。
// 判定と数値はバックエンド（backend/stationProfile.js）が持ち、ここは文言だけを持つ。
// プリレンダ（scripts/prerender.js）もここを使うので拡張子まで明示すること。

const CONCENTRATION_TEXT = {
  concentrated: (p) =>
    `徒歩20分圏内にある施設のうち${p}%が、徒歩5分圏内に収まっています。店が駅のすぐ近くに固まっているタイプです。駅前だけで用事を済ませやすい反面、少し離れると急に選択肢が減ります。`,
  spread: (p) =>
    `徒歩20分圏内にある施設のうち、徒歩5分圏内に収まるのは${p}%です。駅前に集中しておらず、広い範囲に散らばっているタイプです。目的の店まで歩く距離は長くなりがちですが、駅から離れた場所に住んでも不便になりにくい面があります。`,
  average: (p) =>
    `徒歩20分圏内にある施設のうち${p}%が、徒歩5分圏内に収まっています。全国の駅の中では標準的な広がり方です。`,
};

export function concentrationText(concentration) {
  if (!concentration) return "";
  return CONCENTRATION_TEXT[concentration.type](concentration.percent);
}

export function rankText(rank, walkMinutes) {
  if (!rank) return "";
  return `住みやすさ駅前スコアは、集計対象の全${rank.total}駅中${rank.rank}位です（徒歩${walkMinutes}分圏内で比較）。`;
}
