// 駅ごとの「こんな人におすすめ」タグの表示ラベル。
//
// どのタグが付くかの判定（しきい値）はバックエンド側（backend/stationTags.js）が持ち、
// APIは tag_keys としてキーの配列だけを返す。しきい値は集計データと不可分で徒歩分数の
// 段階ごとに変わるため、フロントに複製すると同期漏れの事故が起きやすいことによる。
const TAG_LABELS = {
  family: "子育て世帯向け",
  single: "一人暮らし向け",
  cooking: "自炊・まとめ買い派向け",
  medical: "医療アクセス良好",
};

export function getStationTags(tagKeys) {
  return (tagKeys || [])
    .filter((key) => key in TAG_LABELS)
    .map((key) => ({ key, label: TAG_LABELS[key] }));
}
