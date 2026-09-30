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
    `対応駅${land.of}駅の中では安い方から${landCheapPct(land)}%の位置（${priceLevelLabel(landCheapPct(land))}）です（${land.year}年1月1日時点、${change}）。` +
    `土地の値段なので、家賃の目安とあわせて見てください。`
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

/**
 * 写真の出どころの説明（2026-09-30追加）。source は backend/scripts/fetchStationPhotos.js が付ける
 * - なし / "article": 駅の記事に載っている写真
 * - "commons-geo": 駅の記事に使える写真が無く、Commonsで駅の近くで撮られた駅名入りの写真
 * - "municipality": 駅の写真が見つからず、駅のある市区町村の記事の写真（駅の写真ではない）
 */
export function photoSourceText(article, source) {
  if (source === "commons-geo") {
    return "写真はWikimedia Commonsに登録されている、駅の近くで撮影された写真です。";
  }
  if (source === "municipality") {
    return `この駅の写真が見つからなかったため、駅のある${article}の写真（Wikipedia日本語版の「${article}」の記事に掲載されているもの。Wikimedia Commons）を載せています。駅そのものの写真ではありません。`;
  }
  return `写真はWikipedia日本語版の「${article}」の記事に掲載されているもの（Wikimedia Commons）です。`;
}

// 家賃の目安に使う1Kの広さ（m²）。scripts/stationBundle.js と contentDocs.js も使う
export const RENT_ROOM_M2 = 25;
// 統計（今貸されている借家全体の平均・2023年）を、募集中の物件の家賃の水準に直す倍率の全国一律の値（2026-09-30に検証して決めた）。
// 同日、都道府県ごとの倍率（backend/data/rent-factors.json、backend/scripts/calibrateRent.js）に切り替えたので、
// これは倍率の無い都道府県のときの控えとしてだけ使う。
// アットホームの全国13エリアの平均募集家賃（2026年7月、30m²以下、マンションとアパートの平均）と、
// 同じ地域の統計×25m²を比べると、比は1.29〜1.81・中央値1.52。一定倍率で平均誤差8.2%（1つ抜き検証9.4%）、
// 地価のように曲線で合わせても8.0%（同9.7%）で良くならないので、分かりやすい一定倍率1.5にした。
// 検証の元データと手順: D:/ClaudeData/estat/calib.js（CLAUDE.md「家賃の目安」）
export const RENT_MARKET_FACTOR = 1.5;
// 検証に使った募集家賃の出どころ（画面の注記に出す）
export const RENT_CALIBRATION_NOTE = "アットホーム「全国主要都市の賃貸マンション・アパート募集家賃動向」（2026年7月、30m²以下）の13エリアとの比較";

// 「全国の掲載駅の中で安い方から◯%」を5段階の言葉にする（地価・家賃で共通。2026-09-30追加）
export function priceLevelLabel(cheapPct) {
  if (cheapPct <= 20) return "とても安い";
  if (cheapPct <= 40) return "安い";
  if (cheapPct <= 60) return "ふつう";
  if (cheapPct <= 80) return "高い";
  return "とても高い";
}

/** 地価の、全国の掲載駅の中での位置（安い方から◯%） */
export function landCheapPct(land) {
  return Math.round(((land.of - land.rank_high + 1) / land.of) * 100);
}

export function formatManYen(yen) {
  const man = yen / 10000;
  return `${man >= 10 ? man.toFixed(1).replace(/\.0$/, "") : man.toFixed(1)}万円`;
}

/**
 * 家賃の目安の説明。rent は scripts/stationBundle.js の rent（市区町村の民営借家の1m²当たり家賃）。
 * 駅ごとの相場ではないこと・募集中の物件より低めに出ることを必ず書く
 */
export function rentText(rent) {
  if (!rent) return "";
  const where =
    rent.level === "prefecture"
      ? `駅のある市区町村の値が統計に無いため、${rent.area}全体の値を使っています。${rent.area}`
      : rent.area;
  return (
    `${where}の民営の賃貸住宅の家賃は、平均で1m²あたり${rent.yen_per_m2.toLocaleString("ja-JP")}円です（${rent.year}年の住宅・土地統計調査）。` +
    `1Kの広さの目安の${rent.room_m2}m²に直すと月${formatManYen(rent.stock_monthly)}ですが、これは古い物件も含めた今の借家全体の平均で、募集中の物件より低く出ます。` +
    `その差を補うため、${rent.prefecture}の倍率（${rent.factor}倍）を掛けた月${formatManYen(rent.monthly)}を募集家賃の目安としています。倍率は大都市13エリアの募集家賃と都道府県ごとの成約家賃から出したもので、13エリアでの誤差は平均8%ほどです。` +
    `全国の掲載駅の中では安い方から${rent.cheap_pct}%の位置（${priceLevelLabel(rent.cheap_pct)}）です。` +
    "駅からの距離・築年数・設備で家賃は大きく変わるので、実際の物件の家賃は不動産サイトで確かめてください。"
  );
}

// --- 駅のある市区町村に住んでいる人（2026-09-30追加。国勢調査2020年・保育所等の待機児童2026年4月） ---------
// people は scripts/stationBundle.js の people（backend/scripts/importCensus.js の値＋全掲載駅の中での位置 pctl）

// 画面のカードと静的HTMLの一覧に出す項目。sign は増減率のように符号を付けて出すもの
export const PEOPLE_METRICS = [
  { key: "single_pct", label: "一人暮らしの世帯", of: "世帯のうち" },
  { key: "young_pct", label: "20〜39歳の人", of: "人口のうち" },
  { key: "kids_pct", label: "子ども（18歳未満）のいる世帯", of: "世帯のうち" },
  { key: "senior_pct", label: "65歳以上の人", of: "人口のうち" },
  { key: "pop_change_pct", label: "人口の増減（2015→2020年）", of: "5年間で", sign: true },
];
// 街のようすを言葉にするのは、全掲載駅の中で多い方の4分の1に入り、かつ全国の値の1.1倍以上のときだけ。
// 掲載駅は都市に偏っているので、駅の中の位置だけで決めると地方の平均的な町が「子育て世帯が多い」になり、
// 本文の「全国平均並み」と食い違う（2026-09-30、敦賀駅で確認）
const PEOPLE_HIGH_PCTL = 75;
const PEOPLE_HIGH_RATIO = 1.1;

export const PEOPLE_SOURCE =
  "出典: 総務省「令和2年国勢調査 人口等基本集計」（e-Stat）、こども家庭庁「保育所等関連状況取りまとめ（令和8年4月1日）」を加工して作成";

export function formatPeopleValue(metric, value) {
  if (value === null || value === undefined) return "—";
  return `${metric.sign && value > 0 ? "+" : ""}${value}%`;
}

// 全国の値と比べた言葉。割合の大きさが項目で違うので、差ではなく比で分ける
function compareWord(value, base) {
  const r = value / base;
  if (r >= 1.3) return "全国平均を大きく上回ります";
  if (r >= 1.1) return "全国平均より多めです";
  if (r > 0.9) return "全国平均並みです";
  if (r > 0.7) return "全国平均より少なめです";
  return "全国平均を大きく下回ります";
}

/** 数字から言える街のようす（PEOPLE_HIGH_PCTL・PEOPLE_HIGH_RATIO を満たすものだけ）。当てはまらなければ空 */
export function peopleTypes(people) {
  if (!people) return [];
  const high = (k) =>
    people.pctl[k] !== null && people.pctl[k] > PEOPLE_HIGH_PCTL && people[k] >= people.national[k] * PEOPLE_HIGH_RATIO;
  const types = [];
  if (high("single_pct") && high("young_pct")) types.push("若い一人暮らしの人が多い街");
  else if (high("single_pct")) types.push("一人暮らしの世帯が多い街");
  else if (high("young_pct")) types.push("20〜30代の多い街");
  if (high("kids_pct")) types.push("子育て世帯が多い街");
  if (high("senior_pct")) types.push("高齢の人が多い街");
  // 増減率は全国がマイナスなので比ではなく、多い方の4分の1で1%以上増えたときにする
  if (people.pctl.pop_change_pct > PEOPLE_HIGH_PCTL && people.pop_change_pct >= 1) types.push("人口が増えている街");
  return types;
}

/** 「〇〇区に住んでいる人」欄の見出し */
export function peopleHeading(people) {
  return `${people.area}に住んでいる人`;
}

/** 住んでいる人の要約（1段落）。全国平均との比較と、全掲載駅の中での位置から言葉を選ぶ */
export function peopleSummaryText(stationName, people) {
  if (!people) return "";
  const n = people.national;
  const where =
    people.level === "city"
      ? `${stationName}のある区の値が${people.census_year}年の国勢調査に無いため、${people.area}全体の値です。${people.area}は`
      : `${people.area}（${stationName}のある市区町村）は、`;
  const s = [
    `${where}一人暮らしの世帯が${people.single_pct}%で、${compareWord(people.single_pct, n.single_pct)}（全国${n.single_pct}%）。`,
    `20〜39歳の人は${people.young_pct}%（全国${n.young_pct}%）、65歳以上は${people.senior_pct}%（全国${n.senior_pct}%）です。`,
    `子ども（18歳未満）のいる世帯は${people.kids_pct}%で、${compareWord(people.kids_pct, n.kids_pct)}（全国${n.kids_pct}%）。`,
  ];
  const c = people.pop_change_pct;
  if (c !== null) {
    s.push(
      c >= 0.5
        ? `人口は2015年からの5年間で${c}%増えました（全国は${n.pop_change_pct}%）。`
        : c <= -0.5
          ? `人口は2015年からの5年間で${-c}%減りました（全国は${n.pop_change_pct}%）。`
          : "人口は2015年からの5年間でほぼ横ばいです。"
    );
  }
  const types = peopleTypes(people);
  s.push(
    types.length > 0
      ? `全国の掲載${people.of}駅と比べると、${types.join("・")}です。`
      : `全国の掲載${people.of}駅と比べると、世帯や年齢の構成に目立った偏りはありません。`
  );
  return s.join("");
}

/** カードの下の小さい字（全国・都道府県の値） */
export function peopleMetricSub(metric, people) {
  const pref = people.pref_values?.[metric.key];
  const nat = people.national?.[metric.key];
  const parts = [];
  if (nat !== undefined && nat !== null) parts.push(`全国${formatPeopleValue(metric, nat)}`);
  if (pref !== undefined && pref !== null) parts.push(`${people.prefecture}${formatPeopleValue(metric, pref)}`);
  return parts.join("・");
}

/** 保育園などの待機児童の説明。政令市の区の駅は市全体の値になることも書く */
export function childcareText(people) {
  const c = people?.childcare;
  if (!c) return "";
  const date = "2026年4月1日";
  const cityNote = c.area !== people.area ? `（区ごとの値は公表されていないため、${c.area}全体の値）` : "";
  const sum = people.childcare_summary;
  const s = [`${c.area}の保育所・認定こども園などの待機児童は、${date}時点で${c.waiting}人です${cityNote}。申し込んだ子どもは${c.applicants.toLocaleString("ja-JP")}人でした。`];
  if (c.waiting > 0 && sum) {
    s.push(`全国${sum.municipalities.toLocaleString("ja-JP")}市区町村のうち待機児童がいるのは${sum.with_waiting}市区町村だけなので、入りにくい方の地域です。`);
  }
  if (c.specific_only > 0) {
    s.push(`このほか、特定の園だけを希望して入園を待っている子どもが${c.specific_only.toLocaleString("ja-JP")}人いて、この人数は待機児童に数えられていません。待機児童が少なくても、希望の園に入れるとは限りません。`);
  }
  return s.join("");
}

// 暮らし方別の駅の選び方の記事（scripts/contentDocs.js の articleSingleLife など）
export const LIFE_ARTICLES = [
  { slug: "single-life", label: "一人暮らしの駅の選び方" },
  { slug: "family-life", label: "子育て世帯の駅の選び方" },
  { slug: "senior-life", label: "シニアの駅の選び方" },
];

// --- 同じ路線の大きな駅（2026-09-30追加。scripts/stationBundle.js の line_hubs） -----------------------------
export const LINE_HUBS_NOTE =
  "路線ごとに、このサイトで扱っている駅のうち乗降客数の多い駅を3駅まで載せています。距離は駅どうしの直線距離です。路線は正式な路線名でまとめているため、運転系統によっては途中で乗り換えが必要なことがあります。";

