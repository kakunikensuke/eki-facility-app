// 駅ページの文章。数値と判定は scripts/stationBundle.js（とその先の backend/*.js）が持ち、
// ここは文言だけを持つ。React（pages/StationPage.jsx）とプリレンダ（scripts/prerender.js）の
// 両方がここを使うので、拡張子まで明示すること。
//
// どの文も、駅が変われば数字と結論が変わるものだけを書く。言い回しの入れ替えで駅ごとの差を
// 作らないこと（テンプレートの量産に当たる。2026-09-29に stationComment.js を撤去した理由）。
import { DOMAINS, ITEMS, MAX_TOTAL, formatPeople, formatYenPerM2 } from "./livabilityDefs.js";

const labelOfItem = (key) => ITEMS.find((i) => i.key === key)?.label ?? key;

/**
 * 総合点と、6分野のうち最も高い・低い分野。
 * 同じ総合点でも「食事は全国上位なのに自然・余暇は下位」のような偏りがあり、それが住み方を左右する
 */
export function summaryText(stationName, tier) {
  const head = `${stationName}の徒歩${tier.walk_minutes}分圏内は、${MAX_TOTAL}点中${tier.total}点で、全${tier.of}駅中${tier.rank}位です。`;
  const ranked = DOMAINS.map((d) => ({ ...d, ...tier.domains[d.key] })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (best.score === worst.score) return head;
  return (
    head +
    `6分野で最も高いのは${best.label}（${best.score}点・${best.rank}位）、` +
    `最も低いのは${worst.label}（${worst.score}点・${worst.rank}位）です。`
  );
}

// 施設1種類の「全国の対応駅の中での位置」を上位◯%で言う（パーセンタイルは下からの位置）
export function topShare(pct) {
  return Math.max(1, Math.round(100 - pct));
}

const CONCENTRATION_TEXT = {
  concentrated: (p) =>
    `徒歩20分圏内にある店や病院のうち${p}%が、徒歩5分圏内に収まっています。店が駅のすぐ近くに固まっているタイプです。駅前だけで用事を済ませやすい反面、少し離れると急に選択肢が減ります。`,
  spread: (p) =>
    `徒歩20分圏内にある店や病院のうち、徒歩5分圏内に収まるのは${p}%です。駅前に集中しておらず、広い範囲に散らばっているタイプです。目的の店まで歩く距離は長くなりがちですが、駅から離れた場所に住んでも不便になりにくい面があります。`,
  average: (p) =>
    `徒歩20分圏内にある店や病院のうち${p}%が、徒歩5分圏内に収まっています。全国の駅の中では標準的な広がり方です。`,
};

export function concentrationText(concentration) {
  if (!concentration) return "";
  return CONCENTRATION_TEXT[concentration.type](concentration.percent);
}

// category_reach で使う主要4施設の呼び名（restaurant はカフェを含む集計のまま）
const REACH_LABELS = {
  convenience_store: "コンビニ",
  supermarket: "スーパー",
  hospital: "病院・クリニック",
  restaurant: "飲食店",
};

/**
 * 既定段階で0軒だった主要施設が、範囲を広げると見つかるかどうか。
 * 「0軒」で終わらせず、歩けば解決するのか本当に無いのかまで書く。
 * reaches は backend/stationProfile.js の getCategoryReach が返す配列。
 */
export function categoryReachText(reaches, walkMinutes) {
  if (!reaches || reaches.length === 0) return "";
  const labelOf = (key) => REACH_LABELS[key] ?? key;
  const found = reaches.filter((r) => r.found_at_minutes !== null);
  const notFound = reaches.filter((r) => r.found_at_minutes === null);

  const sentences = [];
  const byMinutes = new Map();
  for (const r of found) {
    if (!byMinutes.has(r.found_at_minutes)) byMinutes.set(r.found_at_minutes, []);
    byMinutes.get(r.found_at_minutes).push(r);
  }
  for (const [minutes, group] of [...byMinutes].sort((a, b) => a[0] - b[0])) {
    const names = group.map((r) => labelOf(r.category)).join("・");
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
    const head = sentences.length > 0 ? `一方、${names}は` : `徒歩${walkMinutes}分圏内に${names}はなく、`;
    sentences.push(`${head}徒歩20分圏内まで広げても見つかりませんでした。`);
  }
  return sentences.join("");
}

/** 最も近い駅との総合点の比較。「隣の駅と比べてどうか」は住む場所を選ぶときの実際の比べ方 */
export function nearestComparisonText(stationName, nearest, walkMinutes) {
  if (!nearest) return "";
  const head = `最も近い${nearest.name}（約${nearest.distance}）は、同じ徒歩${walkMinutes}分圏内で${nearest.total}点、${stationName}は${nearest.own_total}点です。`;
  const diff = Math.round((nearest.own_total - nearest.total) * 10) / 10;
  // 100点満点での数点の差は、施設1〜2種類ぶんの順位の違い程度なので「ほぼ同じ」として扱う
  if (Math.abs(diff) < 3) return `${head}2駅の点数はほぼ同じです。`;
  return diff > 0
    ? `${head}${stationName}のほうが${diff}点高くなっています。`
    : `${head}${nearest.name}のほうが${-diff}点高くなっています。`;
}

/** 地価（公示地価の住宅地）。家賃の相場そのものではないので、目安であることを書く */
export function landText(land) {
  if (!land) return "";
  const range = land.radius_m > 1600 ? `駅から約${land.radius_m / 1000}km以内` : "駅から徒歩20分以内";
  const change =
    land.change_pct === 0
      ? "前年から横ばいです"
      : `前年から${land.change_pct > 0 ? "+" : ""}${land.change_pct}%です`;
  return (
    `${range}にある住宅地の公示地価（${land.points}地点）の中央値は、1m²あたり${formatYenPerM2(land.median_yen_per_m2)}で、` +
    `対応駅${land.of}駅の中で高い方から${land.rank_high}番目です（${land.year}年1月1日時点、${change}）。` +
    `家賃の相場そのものではありませんが、同じ広さの部屋の家賃の高さの目安になります。`
  );
}

/** 乗降客数。駅の規模・朝夕の混み具合の目安 */
export function ridershipText(ridership) {
  if (!ridership) return "";
  const operators = ridership.operators.length > 1 ? `（${ridership.operators.join("・")}の合計）` : "";
  return `1日の乗降客数は${formatPeople(ridership.daily)}${operators}で、対応駅${ridership.of}駅の中で${ridership.rank}番目に多い駅です。`;
}

/**
 * 「施設の揃い方が似ている駅」1駅ぶんの説明。
 * item は backend/stationSimilarity.js の buildSimilarMap が返す1件
 * （close/far の own が基準の駅、other が似ている駅の軒数）。
 */
export function similarStationText(stationName, item) {
  const zero = item.close.filter((c) => c.own === 0 && c.other === 0);
  const nonZero = item.close.filter((c) => !(c.own === 0 && c.other === 0));

  const sentences = [];
  if (nonZero.length > 0) {
    const list = nonZero.map((c) => `${labelOfItem(c.category)}（${c.own}軒と${c.other}軒）`).join("・");
    sentences.push(`${list}が近い水準です。`);
  }
  // 「どちらも0軒」は、軒数のある施設で近いものが無いときだけ書く（0軒どうしの一致は似ている根拠として弱い）
  if (nonZero.length === 0 && zero.length > 0) {
    sentences.push(`${zero.map((c) => labelOfItem(c.category)).join("・")}はどちらも0軒です。`);
  }
  if (item.close.length === 0) {
    sentences.push("1つずつ見ると差はありますが、施設の組み合わせ全体では近い駅です。");
  }
  if (item.far) {
    sentences.push(
      `違いが大きいのは${labelOfItem(item.far.category)}で、${stationName}の${item.far.own}軒に対して${item.far.other}軒です。`
    );
  }
  return sentences.join("");
}

// 「似ている駅」の前置き（画面と静的HTMLで共通）
export function similarLead(walkMinutes, minDistanceKm = 1.6) {
  return `徒歩${walkMinutes}分圏内の${ITEMS.length}種類の施設の軒数の組み合わせが近い駅を、全国から選んでいます。集計範囲が重なる${minDistanceKm}km以内の駅は除いています。`;
}

/** 写真の帰属表示（CC BYの条件）。「撮影: 〇〇 / CC BY-SA 4.0」 */
export function photoCredit(photo) {
  return `撮影: ${photo.artist} / ${photo.license}`;
}

/**
 * 県内での総合点の順位（2026-09-30追加）。pr は scripts/stationBundle.js の pref_rank。
 * 全国順位だけだと、地方の駅は「全国の下の方」としか分からないので、同じ県の中での位置を言う
 */
export function prefRankText(stationName, pr, walkMinutes) {
  if (!pr || pr.of < 2) return "";
  const head = `${stationName}の総合点（徒歩${walkMinutes}分圏内）は、${pr.prefecture}で掲載している${pr.of}駅の中で${pr.rank}位です。`;
  const gap = (a, b) => Math.round(Math.abs(a - b) * 10) / 10;
  const parts = [];
  if (pr.second) parts.push(`2位の${pr.second.name}（${pr.second.total}点）とは${gap(pr.second.total, pr.own)}点差です。`);
  if (pr.first) parts.push(`1位は${pr.first.name}の${pr.first.total}点です。`);
  if (pr.above) parts.push(`1つ上の${pr.above.name}は${pr.above.total}点`);
  if (pr.below) parts.push(`${pr.above ? "、" : ""}1つ下の${pr.below.name}は${pr.below.total}点`);
  if (pr.above || pr.below) parts.push("です。");
  return head + parts.join("");
}

/** 路線ごとの順位を1文にまとめる。ranks は stationBundle.js の line_ranks */
export function lineRankText(stationName, ranks) {
  if (!ranks || ranks.length === 0) return "";
  const list = ranks
    .slice(0, 4)
    .map((r) => `${r.name}の掲載${r.of}駅中${r.rank}位`)
    .join("、");
  const tops = ranks.filter((r) => r.rank === 1).map((r) => r.name);
  const tail = tops.length > 0 ? `${tops.join("・")}では掲載駅の中で最も点の高い駅です。` : "";
  return `同じ路線の駅と比べると、${stationName}は${list}です。${tail}`;
}

// 「駅から近い施設」で、暮らしの用事に使う順に見る種類（buildNearbyFacilities.js の LISTED の一部）
export const DAILY_KEYS = ["supermarket", "convenience_store", "drugstore", "hospital", "post_office"];
// 徒歩5分・10分の目安（徒歩1分=80m）
export const NEAR_M = 400;
const MID_M = 800;

export function formatMeters(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/** 駅から近い施設の前置き（画面と静的HTMLで共通）。radiusM は buildNearbyFacilities.js の MAX_RADIUS_M */
export function nearbyFacilitiesLead(radiusM = 1600) {
  return `OpenStreetMapに名前が登録されている施設を、駅に近い順に最大3件載せています。距離は駅からの直線距離で、実際の道のりはこれより長くなります。徒歩${radiusM / 80}分圏（${formatMeters(radiusM)}）より遠い施設は載せていません。`;
}

/**
 * 日々の用事に使う施設がどこまで行けばあるか、を1段落で言う。
 * nearby は stationBundle.js の nearby_facilities（種類 → { nearest_m, named }）
 */
export function nearbySummaryText(stationName, nearby) {
  if (!nearby) return "";
  const near = [];
  const mid = [];
  const far = [];
  const none = [];
  for (const key of DAILY_KEYS) {
    const e = nearby[key];
    if (!e) none.push(labelOfItem(key));
    else if (e.nearest_m <= NEAR_M) near.push(labelOfItem(key));
    else if (e.nearest_m <= MID_M) mid.push(`${labelOfItem(key)}（約${formatMeters(e.nearest_m)}）`);
    else far.push(`${labelOfItem(key)}（約${formatMeters(e.nearest_m)}）`);
  }
  const s = [];
  if (near.length === DAILY_KEYS.length) {
    s.push(`${stationName}から直線${NEAR_M}m（徒歩5分の目安）以内に、${near.join("・")}がすべてそろっています。`);
  } else if (near.length > 0) {
    s.push(`${stationName}から直線${NEAR_M}m（徒歩5分の目安）以内にあるのは${near.join("・")}です。`);
  } else {
    s.push(`${stationName}から直線${NEAR_M}m（徒歩5分の目安）以内には、スーパー・コンビニ・ドラッグストア・病院・郵便局のどれもありません。`);
  }
  if (mid.length > 0) s.push(`徒歩10分の目安（${MID_M}m）までに${mid.join("・")}があります。`);
  if (far.length > 0) s.push(`${far.join("・")}は徒歩10分より先です。`);
  if (none.length > 0) s.push(`${none.join("・")}は徒歩20分圏内に見つかりませんでした。`);
  return s.join("");
}

/** 1種類ぶんの一覧。名前の無い施設のほうが近いときは、その距離も書く */
export function nearbyItemText(entry) {
  const names = entry.named.map(([name, m]) => `${name}（約${formatMeters(m)}）`).join("、");
  const closer =
    entry.named.length === 0
      ? `名前の登録がない施設が約${formatMeters(entry.nearest_m)}にあります`
      : entry.nearest_m + 50 < entry.named[0][1]
        ? `。名前の登録がない施設が約${formatMeters(entry.nearest_m)}にあります`
        : "";
  return names + closer;
}

/** 駅から近い施設の一覧に出す種類と順番（ITEMS の順） */
export function nearbyFacilityRows(nearby) {
  if (!nearby) return [];
  return ITEMS.filter((i) => nearby[i.key]).map((i) => ({ key: i.key, label: i.label, text: nearbyItemText(nearby[i.key]) }));
}

/** 「県内・路線内の位置」欄の見出し。路線の比較が無い駅（路線ページの無い路線だけの駅）は県だけにする */
export function localRankHeading(prefecture, lineRanks) {
  return lineRanks && lineRanks.length > 0 ? `${prefecture}・同じ路線の駅の中での位置` : `${prefecture}の駅の中での位置`;
}
