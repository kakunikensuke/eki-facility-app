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

// 上位・下位の順位差がこれ以上あるとき、カテゴリごとの偏りに触れる。
// 349駅中の順位なので、100位以上離れていれば「同じ総合順位でも中身が違う」と言える幅がある。
const CATEGORY_RANK_GAP = 100;

/**
 * カテゴリ別の全国順位。総合順位1つでは消えてしまう駅の中身の違いを出す。
 * categoryRanks は backend/stationProfile.js の buildCategoryRankMap が返す1駅ぶん。
 */
export function categoryRankText(categoryRanks, categories, walkMinutes) {
  if (!categoryRanks) return "";

  const ranked = categories
    .map((cat) => ({ label: cat.label, ...categoryRanks[cat.key] }))
    .filter((r) => r.rank)
    .sort((a, b) => a.rank - b.rank);
  if (ranked.length === 0) return "";

  const total = ranked[0].total;
  const list = ranked.map((r) => `${r.label}が${r.rank}位`).join("、");
  const head = `カテゴリ別の順位は、${list}です（いずれも全${total}駅中、徒歩${walkMinutes}分圏内で比較）。`;

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (worst.rank - best.rank < CATEGORY_RANK_GAP) return head;

  return `${head}${best.label}と${worst.label}で${worst.rank - best.rank}位の開きがあり、カテゴリによって充実度が偏っているタイプです。`;
}

/**
 * 既定段階で0軒だったカテゴリが、範囲を広げると見つかるかどうか。
 * 「0軒」で終わらせず、歩けば解決するのか本当に無いのかまで書く。
 * reaches は backend/stationProfile.js の getCategoryReach が返す配列。
 */
export function categoryReachText(reaches, categories, walkMinutes) {
  if (!reaches || reaches.length === 0) return "";

  const labelOf = (key) => categories.find((c) => c.key === key)?.label ?? key;
  const found = reaches.filter((r) => r.found_at_minutes !== null);
  const notFound = reaches.filter((r) => r.found_at_minutes === null);

  const sentences = [];

  // 見つかる段階が同じものはまとめる（「スーパー・病院は徒歩15分圏で」の形にする）
  const byMinutes = new Map();
  for (const r of found) {
    if (!byMinutes.has(r.found_at_minutes)) byMinutes.set(r.found_at_minutes, []);
    byMinutes.get(r.found_at_minutes).push(r);
  }
  for (const [minutes, group] of [...byMinutes].sort((a, b) => a[0] - b[0])) {
    const names = group.map((r) => labelOf(r.category)).join("・");
    // 1つだけなら「1軒見つかります」で通じるが、複数あるとどれが何軒か分からなくなる
    const detail =
      group.length === 1
        ? `${group[0].count}軒見つかります`
        : `${group.map((r) => `${labelOf(r.category)}が${r.count}軒`).join("、")}見つかります`;
    sentences.push(
      `徒歩${walkMinutes}分圏内に${names}はありませんが、徒歩${minutes}分まで範囲を広げると${detail}。`
    );
  }

  if (notFound.length > 0) {
    const names = notFound.map((r) => labelOf(r.category)).join("・");
    // 見つかったカテゴリの話をした直後なら、続きの文として繋ぐ
    const head = sentences.length > 0 ? `一方、${names}は` : `徒歩${walkMinutes}分圏内に${names}はなく、`;
    sentences.push(`${head}徒歩20分圏内まで広げても見つかりませんでした。`);
  }

  return sentences.join("");
}

/**
 * 最も近い駅との比較。「隣の駅と比べてどうか」は住む場所を選ぶときの実際の比べ方で、
 * その駅単体の数字だけでは出てこない。
 * nearest は { name, km, total } （total は同じ段階の合計軒数）。
 */
export function nearestComparisonText(stationName, nearest, ownTotal, walkMinutes) {
  if (!nearest || !nearest.total || !ownTotal) return "";

  const [more, less] = ownTotal >= nearest.total ? [stationName, nearest.name] : [nearest.name, stationName];
  const ratio = Math.max(ownTotal, nearest.total) / Math.min(ownTotal, nearest.total);

  const head = `最も近い${nearest.name}（約${nearest.distance}）の徒歩${walkMinutes}分圏内の合計は${nearest.total}軒で、${stationName}は${ownTotal}軒です。`;

  // 差がごくわずかなときに「◯倍」と言うと大げさになるので、同水準として扱う
  if (ratio < 1.2) return `${head}2駅の施設数はほぼ同水準です。`;
  return `${head}${more}のほうが${less}より約${ratio.toFixed(1)}倍多くなっています。`;
}
