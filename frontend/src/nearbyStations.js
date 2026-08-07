// 駅ページから「近くの駅」へ張る内部リンクを作るための近隣駅の抽出。
//
// なぜ必要か:
// プリレンダ(scripts/prerender.js)以前は駅ページへのリンクがトップの一覧しか無く、
// クローラから見ると全349駅がトップから1階層にぶら下がるだけの平たい構造だった。
// 駅同士を結んでおくと、クロール経路が増えるうえ、利用者にとっても
// 「この駅がダメなら隣は？」という実際の使われ方に沿った導線になる。
//
// ビルド時のプリレンダがNodeから直接importするため、拡張子まで明示すること。

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// 2地点間の直線距離(km)。徒歩の実距離ではなく近さの順位づけにしか使わないため
// 地球を球とみなす簡易計算で足りる。
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// 表示用の距離文字列。1km未満はm単位にする（駅間だと0.4kmより400mの方が距離感が掴みやすい）
export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 100) * 10}m`;
  return `${km.toFixed(1)}km`;
}

// 近い順にlimit駅を返す。lat/lonを持たない駅（APIの応答形式が古い場合など）は
// 距離を出せないので黙って除外する。
export function findNearbyStations(station, stations, limit = 6) {
  if (!station || typeof station.lat !== "number" || typeof station.lon !== "number") {
    return [];
  }
  return stations
    .filter((s) => s.slug !== station.slug && typeof s.lat === "number" && typeof s.lon === "number")
    .map((s) => ({ station: s, km: distanceKm(station, s) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
