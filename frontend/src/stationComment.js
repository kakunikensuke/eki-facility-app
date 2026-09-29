// ビルド時のプリレンダ（scripts/prerender.js）がNodeから直接importするため、拡張子まで明示する
import { CATEGORIES } from "./categories.js";

// 駅ごとの実データから一言コメントを生成する（AdSense審査対策として各駅ページの記述内容に
// 差をつけるための機能）。
//
// 2026-09-29、駅名のハッシュで3通りの言い回しから1つを選ぶ方式をやめた。
// 言い回しを入れ替えるだけでは中身は同じで、Googleが「scaled content abuse」として嫌う
// テンプレートの量産そのものになる。「落ち着いた雰囲気」「静けさを重視した」のように
// データから言えないことを書いている言い回しもあった。
// 今は、数字が変われば結論も変わる文だけを1通りの言い方で書く。
//
// tierはAPIが返す1段階ぶんのデータ（counts / score / targets / walk_minutes / tag_thresholds）。
// 「多い/少ない」の判定に使うtargetsは徒歩分数の段階ごとに値が変わるため、
// フロントで複製せずAPIの値をそのまま使う（backend/scoring.js参照）。

// 何カテゴリが上位25%の水準（target）に届いているかを数で言う。
// 「充実している」のような言葉にすると、何点から言ってよいかの線引きが恣意的になる
function scoreSentence(stationName, tier) {
  const reached = CATEGORIES.filter((cat) => (tier.counts[cat.key] || 0) >= tier.targets[cat.key]);
  const head = `${stationName}の徒歩${tier.walk_minutes}分圏内のスコアは${tier.score.total}点です。`;
  if (reached.length === CATEGORIES.length) {
    return `${head}コンビニ・スーパー・病院・飲食店の4つとも、全国の上位25%の水準に届いています。`;
  }
  if (reached.length === 0) return `${head}4カテゴリのどれも、全国の上位25%の水準には届いていません。`;
  return `${head}全国の上位25%の水準に届いているのは、${reached.map((c) => c.label).join("・")}の${reached.length}つです。`;
}

export function buildStationComment(stationName, tier) {
  const ratios = CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    count: tier.counts[cat.key] || 0,
    target: tier.targets[cat.key],
    ratio: (tier.counts[cat.key] || 0) / tier.targets[cat.key],
  }));
  const strongest = [...ratios].sort((a, b) => b.ratio - a.ratio)[0];
  const weakest = [...ratios].sort((a, b) => a.ratio - b.ratio)[0];

  // 充足度（上位25%の水準＝targetに対する割合）が最も高い/低いカテゴリ。
  // 軒数そのものではなく割合で比べるのは、飲食店と病院では桁が違うため
  const detailSentence =
    strongest.key === weakest.key || strongest.ratio === weakest.ratio
      ? ""
      : `上位25%の水準に対する割合が最も高いのは${strongest.label}（${strongest.count}軒、水準は${strongest.target}軒）、` +
        `最も低いのは${weakest.label}（${weakest.count}軒、水準は${weakest.target}軒）です。`;

  // 「多い」の基準は各段階の75パーセンタイル値（＝上位25%の駅に入る水準）
  const extras = [];
  if ((tier.counts.park || 0) >= tier.tag_thresholds.park) extras.push(`公園（${tier.counts.park}軒）`);
  if ((tier.counts.nursery || 0) >= tier.tag_thresholds.nursery)
    extras.push(`保育園・幼稚園（${tier.counts.nursery}軒）`);
  const extraSentence =
    extras.length > 0 ? `スコア対象外の施設では、${extras.join("と")}が全国の上位25%に入ります。` : "";

  return [scoreSentence(stationName, tier), detailSentence, extraSentence].filter(Boolean).join("");
}
