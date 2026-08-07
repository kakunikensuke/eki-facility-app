/**
 * 駅ごとの「こんな人におすすめ」タグ判定（2026-07-31追加、AdSense審査対策として
 * 各駅ページの記述に差をつけるための機能。要件定義書10章4項参照）。
 *
 * しきい値は各カテゴリの75パーセンタイル値（scoring.jsのtargetと同じ考え方）。
 * 2026-08-07の4段階化に伴い、段階ごとに別のしきい値を持たせている。
 * 値の再計算は scripts/computeScoreTargets.js で行う。
 *
 * ここが返すのはタグのキーだけで、表示ラベルはフロントエンド側（frontend/src/stationTags.js）
 * が持つ。しきい値は集計データと不可分なのでバックエンドに置き、文言は表示の都合で
 * 変わりうるのでフロントに置く、という切り分け。
 */

// 2026-08-07、全349駅の4段階実データから算出した75パーセンタイル値。
const TAG_THRESHOLDS_BY_WALK_MINUTES = {
  5: {
    convenience_store: 13,
    supermarket: 4,
    hospital: 3,
    restaurant: 77,
    park: 5,
    nursery: 2,
    drugstore: 1,
  },
  10: {
    convenience_store: 27,
    supermarket: 9,
    hospital: 7,
    restaurant: 143,
    park: 17,
    nursery: 7,
    drugstore: 3,
  },
  15: {
    convenience_store: 47,
    supermarket: 15,
    hospital: 13,
    restaurant: 227,
    park: 36,
    nursery: 15,
    drugstore: 5,
  },
  20: {
    convenience_store: 86,
    supermarket: 26,
    hospital: 21,
    restaurant: 386,
    park: 62,
    nursery: 26,
    drugstore: 8,
  },
};

const TAG_RULES = [
  {
    key: "family",
    test: (c, t) => c.park >= t.park && c.nursery >= t.nursery,
  },
  {
    key: "single",
    test: (c, t) => c.convenience_store >= t.convenience_store && c.restaurant >= t.restaurant,
  },
  {
    key: "cooking",
    test: (c, t) => c.supermarket >= t.supermarket && c.drugstore >= t.drugstore,
  },
  {
    key: "medical",
    test: (c, t) => c.hospital >= t.hospital,
  },
];

function getStationTagKeys(counts, walkMinutes) {
  const thresholds = TAG_THRESHOLDS_BY_WALK_MINUTES[walkMinutes];
  if (!thresholds) {
    throw new Error(`徒歩${walkMinutes}分のタグしきい値が未定義です（stationTags.js）`);
  }
  return TAG_RULES.filter((rule) => rule.test(counts, thresholds)).map((rule) => rule.key);
}

module.exports = { getStationTagKeys, TAG_THRESHOLDS_BY_WALK_MINUTES };
