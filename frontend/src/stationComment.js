// ビルド時のプリレンダ（scripts/prerender.js）がNodeから直接importするため、拡張子まで明示する
import { CATEGORIES } from "./categories.js";

// 文言バリエーションの選択に使う簡易ハッシュ。駅名(+salt)から常に同じ値を返すため、
// 同じ駅は再訪しても同じ文言になる(SEO上のコンテンツ安定性のため)一方、
// 別の駅同士では異なるバリエーションが選ばれやすくなる。
function pickVariant(seed, salt, variants) {
  let hash = 0;
  const s = seed + salt;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return variants[Math.abs(hash) % variants.length];
}

const SCORE_TIERS = [
  {
    min: 80,
    templates: [
      (name, walk) => `${name}は徒歩${walk}分圏内の生活利便施設が非常に充実しているエリアです。`,
      (name, walk) =>
        `${name}周辺は徒歩${walk}分圏内に生活に必要な施設が数多く揃う、利便性の高いエリアです。`,
      (name, walk) => `${name}は徒歩${walk}分圏内の店舗充実度が全国の駅の中でも上位クラスです。`,
    ],
  },
  {
    min: 50,
    templates: [
      (name, walk) => `${name}は徒歩${walk}分圏内に生活に必要な施設が一通り揃っているエリアです。`,
      (name, walk) =>
        `${name}周辺は徒歩${walk}分圏内でひと通りの買い物・外食が完結できるエリアです。`,
      (name, walk) => `${name}は徒歩${walk}分圏内の生活利便性がバランス良く整っているエリアです。`,
    ],
  },
  {
    min: 0,
    templates: [
      (name, walk) =>
        `${name}周辺は徒歩${walk}分圏内の店舗数が全国の駅と比べてやや少なめのエリアです。`,
      (name, walk) =>
        `${name}は徒歩${walk}分圏内の店舗数は控えめで、落ち着いた雰囲気のエリアです。`,
      (name, walk) =>
        `${name}周辺は徒歩${walk}分圏内では、店舗数よりも静けさを重視したエリアといえそうです。`,
    ],
  },
];

const DETAIL_TEMPLATES = [
  (strongest, weakest) =>
    `特に${strongest.label}が${strongest.count}軒と充実している一方、${weakest.label}は${weakest.count}軒です。`,
  (strongest, weakest) =>
    `${strongest.label}の軒数は${strongest.count}軒とこのエリアの強みです。一方で${weakest.label}は${weakest.count}軒にとどまります。`,
  (strongest, weakest) =>
    `${strongest.count}軒の${strongest.label}が目立つエリアですが、${weakest.label}は${weakest.count}軒とやや少なめです。`,
];

const EXTRA_TEMPLATES = [
  (extras) => `${extras.join("、")}、子育て世帯にも参考になるエリアです。`,
  (extras) => `${extras.join("、")}という特徴もあり、子育て世帯にとって参考になりそうです。`,
];

// 駅ごとの実データから一言コメントを生成する(要件定義書10章の収益化準備の一環、
// AdSense審査対策として各駅ページの記述内容に差をつけるための機能)。
//
// tierはAPIが返す1段階ぶんのデータ（counts / score / targets / walk_minutes）。
// 「充実している/少なめ」の判定に使うtargetsは、徒歩分数の段階ごとに値が変わるため
// フロントで複製せずAPIの値をそのまま使う（backend/scoring.js参照）。
export function buildStationComment(stationName, tier) {
  const ratios = CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    count: tier.counts[cat.key] || 0,
    ratio: (tier.counts[cat.key] || 0) / tier.targets[cat.key],
  }));
  const strongest = [...ratios].sort((a, b) => b.ratio - a.ratio)[0];
  const weakest = [...ratios].sort((a, b) => a.ratio - b.ratio)[0];

  const scoreTier = SCORE_TIERS.find((t) => tier.score.total >= t.min);
  const scoreTemplate = pickVariant(stationName, "score", scoreTier.templates);
  const scoreSentence = scoreTemplate(stationName, tier.walk_minutes);

  const detailSentence =
    strongest.key === weakest.key
      ? ""
      : pickVariant(stationName, "detail", DETAIL_TEMPLATES)(strongest, weakest);

  // 「多い」の基準は各段階の75パーセンタイル値（＝上位25%の駅に入る水準）。
  // 段階によって集計面積が変わるため、固定の軒数ではなくAPIが返すしきい値で判定する。
  const extras = [];
  if ((tier.counts.park || 0) >= tier.tag_thresholds.park) extras.push("公園も多く");
  if ((tier.counts.nursery || 0) >= tier.tag_thresholds.nursery)
    extras.push("保育園・幼稚園も複数あり");
  const extraSentence =
    extras.length > 0 ? pickVariant(stationName, "extra", EXTRA_TEMPLATES)(extras) : "";

  return [scoreSentence, detailSentence, extraSentence].filter(Boolean).join("");
}
