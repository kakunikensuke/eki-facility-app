// ページごとの title / description の文言。
// ビルド時のプリレンダ（scripts/prerender.js）と、実行時のReact側（useDocumentTitle）の
// 双方からimportして使う。片方だけ直すと生HTMLと画面のtitleがズレるため、必ずここを直すこと。

export const SITE_NAME = "住みやすさ駅前スコア";

export function topTitle() {
  return `${SITE_NAME}｜全国の駅前の店舗数を比較`;
}

export function topDescription(stationCount) {
  return `全国${stationCount}駅の駅前の住みやすさをスコア化。駅名を選ぶと徒歩5〜20分圏内のコンビニ・スーパー・病院・飲食店の軒数がわかります。`;
}

export function stationTitle(stationName) {
  return `${stationName}の住みやすさ駅前スコア｜コンビニ・スーパー・病院・飲食店の軒数`;
}

// descriptionは既定の段階（徒歩10分）を基準にする。4段階すべてを詰め込むと
// 検索結果に出る文言が冗長になり、かつ表示上切り捨てられるため。
export function stationDescription(stationName, tier) {
  const c = tier.counts;
  return (
    `${stationName}の住みやすさ駅前スコアは${tier.score.total}点。` +
    `徒歩${tier.walk_minutes}分圏内にコンビニ${c.convenience_store || 0}軒、` +
    `スーパー${c.supermarket || 0}軒、病院${c.hospital || 0}軒、飲食店${c.restaurant || 0}軒。` +
    `徒歩5分・15分・20分圏内の軒数も確認できます。`
  );
}

// 固定ページ（駅データに依存しないページ）
export const STATIC_PAGES = [
  {
    path: "/compare",
    heading: "駅を比較する",
    title: `駅を比較する｜${SITE_NAME}`,
    description: "複数の駅の住みやすさ駅前スコアと店舗数を並べて比較できます。",
  },
  {
    path: "/guide",
    heading: "スコアの見方",
    title: `スコアの見方｜${SITE_NAME}`,
    description: "住みやすさ駅前スコアの算出方法と、各カテゴリの基準値について説明します。",
  },
  {
    path: "/privacy",
    heading: "プライバシーポリシー",
    title: `プライバシーポリシー｜${SITE_NAME}`,
    description: "住みやすさ駅前スコアのプライバシーポリシーです。",
  },
];
