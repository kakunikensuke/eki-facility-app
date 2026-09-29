// ページごとの title / description の文言。
// ビルド時のプリレンダ（scripts/prerender.js）と、実行時のReact側（useDocumentTitle）の
// 双方からimportして使う。片方だけ直すと生HTMLと画面のtitleがズレるため、必ずここを直すこと。

import { ITEMS, MAX_TOTAL } from "./livabilityDefs.js";

export const SITE_NAME = "住みやすさ駅前スコア";

export function topTitle() {
  return `${SITE_NAME}｜駅の暮らしやすさを${MAX_TOTAL}点で採点・地価も比較`;
}

export function topDescription(stationCount) {
  return `全国${stationCount}駅の暮らしやすさを${MAX_TOTAL}点満点で採点。徒歩5〜20分圏内の${ITEMS.length}種類の施設から、買い物・食事・医療・子育て・生活・余暇の6分野で評価し、住宅地の地価と乗降客数も比較できます。`;
}

export function stationTitle(stationName) {
  return `${stationName}の住みやすさ駅前スコア｜買い物・医療・子育てなど6分野の評価と地価`;
}

// descriptionは既定の段階（徒歩10分）を基準にする。4段階すべてを詰め込むと
// 検索結果に出る文言が冗長になり、かつ表示上切り捨てられるため。
export function stationDescription(stationName, tier) {
  return (
    `${stationName}の住みやすさ駅前スコアは${MAX_TOTAL}点中${tier.total}点（全${tier.of}駅中${tier.rank}位）。` +
    `徒歩${tier.walk_minutes}分圏内の${ITEMS.length}種類の施設から、買い物・食事・医療・子育て・生活・余暇の6分野で評価。` +
    `住宅地の地価と1日の乗降客数、似ている駅も掲載。`
  );
}

// 路線ページ・記事の入口。フッター（components/Footer.jsx と prerender.js の siteFooterHtml）に
// 駅一覧の次に並べる。STATIC_PAGES と違い本文は scripts/contentDocs.js がデータから作る
export const CONTENT_SECTIONS = [
  { path: "/lines", label: "路線から探す" },
  { path: "/articles", label: "データで見る駅選び" },
];

// お気に入りページはブラウザのlocalStorage次第で中身が変わるため、
// プリレンダ対象（STATIC_PAGES）には入れずtitleだけ用意する
export const FAVORITES_META = {
  title: `お気に入り駅｜${SITE_NAME}`,
  description: "お気に入りに登録した駅の住みやすさ駅前スコアをまとめて確認できます。",
};

// 固定ページ（駅データに依存しないページ）
export const STATIC_PAGES = [
  {
    // 2026-09-29追加。駅名が決まっていない人が、店の条件から駅を探す入口
    path: "/search",
    heading: "条件で駅を探す",
    title: `条件で駅を探す｜スーパー・病院・公園の数で絞り込み｜${SITE_NAME}`,
    description:
      "徒歩5〜20分圏内のスーパー・病院・公園・保育園などの最低軒数と都道府県で駅を絞り込み、一人暮らし・子育て・自炊など重視する項目に沿って並べ替えられます。",
  },
  {
    path: "/compare",
    heading: "駅を比較する",
    title: `駅を比較する｜${SITE_NAME}`,
    description: "複数の駅の住みやすさ駅前スコアと店舗数を並べて比較できます。",
  },
  {
    path: "/guide",
    heading: "使い方・スコアの見方",
    title: `使い方・スコアの見方｜${SITE_NAME}`,
    description:
      "住みやすさ駅前スコアの算出方法（19種類の施設・6分野・100点満点）、集計範囲の取り方、地価・乗降客数・災害リスクのデータの出どころと限界について説明します。",
  },
  {
    path: "/about",
    heading: "運営者情報",
    title: `運営者情報｜${SITE_NAME}`,
    description:
      "住みやすさ駅前スコアの運営者、サービスを作った理由、スコアの作り方とその限界、収益についての方針を記載しています。",
  },
  {
    path: "/contact",
    heading: "お問い合わせ",
    title: `お問い合わせ｜${SITE_NAME}`,
    description:
      "住みやすさ駅前スコアへのお問い合わせフォームです。データの誤りのご指摘、駅の追加リクエスト、掲載内容についてのご連絡を受け付けています。",
  },
  {
    // お問い合わせフォームの送信後の戻り先（content/pages.js の CONTACT_RECEIVED_PATH）。
    // このページが無いと送信後に404になる。
    //
    // noindex にしている理由: 送信を終えた人だけが見る通過ページであり、検索から
    // 直接来ても意味がない。にもかかわらず sitemap に載せてインデックス対象にし、
    // フッターにも「お問い合わせを受け付けました」というリンクを並べていた
    // （2026-08-29に修正）。中身の薄いページを自分から検索対象に差し出す形になっており、
    // AdSenseの「有用性の低いコンテンツ」判定を招く要因になっていた。
    path: "/contact-received",
    heading: "お問い合わせを受け付けました",
    title: `お問い合わせを受け付けました｜${SITE_NAME}`,
    description:
      "お問い合わせの送信後のご案内です。いただいた内容をこの後どう扱うか、返信の目安、データの誤りのご指摘への対応方針を記載しています。",
    noindex: true,
    // フッターの共通リンクにも出さない（通過ページのため）
    hideFromNav: true,
  },
  {
    path: "/privacy",
    heading: "プライバシーポリシー",
    title: `プライバシーポリシー｜${SITE_NAME}`,
    description: "住みやすさ駅前スコアのプライバシーポリシーです。",
  },
];
