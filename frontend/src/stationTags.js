// 駅ごとの「こんな人におすすめ」タグ判定(AdSense審査対策として各駅ページの記述に差をつけるための機能、
// stationComment.jsの一言コメントと同様の位置づけ)。
//
// しきい値は全国349駅の実データ分布(2026-07-27時点)の75パーセンタイル値を基準にしている。
// コンビニ/スーパー/病院/飲食店はscoring.jsのSCORE_TARGETSと同じ値(=75パーセンタイル値)を流用し、
// スコア対象外の公園・保育園幼稚園・ドラッグストアは同スナップショットで別途算出した75パーセンタイル値を使う。
const THRESHOLDS = {
  convenience_store: 27,
  supermarket: 8,
  hospital: 7,
  restaurant: 140,
  park: 17,
  nursery: 7,
  drugstore: 3,
};

const TAG_RULES = [
  {
    key: "family",
    label: "子育て世帯向け",
    test: (c) => c.park >= THRESHOLDS.park && c.nursery >= THRESHOLDS.nursery,
  },
  {
    key: "single",
    label: "一人暮らし向け",
    test: (c) =>
      c.convenience_store >= THRESHOLDS.convenience_store && c.restaurant >= THRESHOLDS.restaurant,
  },
  {
    key: "cooking",
    label: "自炊・まとめ買い派向け",
    test: (c) => c.supermarket >= THRESHOLDS.supermarket && c.drugstore >= THRESHOLDS.drugstore,
  },
  {
    key: "medical",
    label: "医療アクセス良好",
    test: (c) => c.hospital >= THRESHOLDS.hospital,
  },
];

export function getStationTags(counts) {
  return TAG_RULES.filter((rule) => rule.test(counts)).map((rule) => ({
    key: rule.key,
    label: rule.label,
  }));
}
