// 駅ページの「駅の周りの地図」（2026-11-06追加）。画面（StationPage.jsx）と静的HTML（scripts/prerender.js）の両方が使う。
//
// 地図のライブラリは使わない。国土地理院の地図タイル（淡色地図）を並べ、その上に施設の印を置くだけなので、
// JavaScript を実行しなくても静的HTMLのまま表示できる。位置はすべて地図の枠に対する % で持つ（幅に合わせて伸び縮みする）。
// 施設の位置は backend/scripts/buildStationMap.js が作る（station-map.json）。

// backend/scripts/buildStationMap.js の MAP_CATS と同じ並び
export const MAP_CATS = [
  { key: "supermarket", label: "スーパー", color: "#e0702b" },
  { key: "convenience_store", label: "コンビニ", color: "#2b74d0" },
  { key: "drugstore", label: "ドラッグストア", color: "#8b4fd0" },
  { key: "hospital", label: "病院・クリニック", color: "#d33f49" },
  { key: "nursery", label: "保育園・幼稚園", color: "#c9971a" },
  { key: "park", label: "公園", color: "#2f9a57" },
];
const SHOP_CATS = [0, 1, 2];

export const MAP_RADIUS_M = 800;
// 地図の枠は駅を中心に1辺1,800m（徒歩10分の円が入り、少し余白が残る）
const BOX_M = 1800;
const ZOOM = 15;
const TILE = 256;

export const MAP_TILE_CREDIT = {
  text: "国土地理院（地理院タイル・淡色地図）",
  href: "https://maps.gsi.go.jp/development/ichiran.html",
};

const tileUrl = (x, y) => `https://cyberjapandata.gsi.go.jp/xyz/pale/${ZOOM}/${x}/${y}.png`;

function worldPx(lat, lon) {
  const n = TILE * 2 ** ZOOM;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

const pct = (v) => Math.round(v * 1000) / 1000;

// rows: station-map.json の1駅分（[種類, 緯度のずれ, 経度のずれ, 距離m, 名前 or 0]）
export function mapLayout(lat, lon, rows) {
  const c = worldPx(lat, lon);
  const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM;
  const boxPx = BOX_M / metersPerPx;
  const x0 = c.x - boxPx / 2;
  const y0 = c.y - boxPx / 2;
  const tiles = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + boxPx) / TILE); ty++) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + boxPx) / TILE); tx++) {
      tiles.push({
        src: tileUrl(tx, ty),
        left: pct(((tx * TILE - x0) / boxPx) * 100),
        top: pct(((ty * TILE - y0) / boxPx) * 100),
        size: pct((TILE / boxPx) * 100),
      });
    }
  }
  const markers = rows.map(([ci, dLat, dLon, m, name]) => {
    const p = worldPx(lat + dLat / 1e5, lon + dLon / 1e5);
    const cat = MAP_CATS[ci];
    return {
      left: pct(((p.x - x0) / boxPx) * 100),
      top: pct(((p.y - y0) / boxPx) * 100),
      color: cat.color,
      label: `${cat.label}: ${name || "名前の登録なし"}（約${m}m）`,
    };
  });
  return {
    tiles,
    markers,
    rings: [
      { size: pct(((2 * 400) / BOX_M) * 100), label: "徒歩5分" },
      { size: pct(((2 * MAP_RADIUS_M) / BOX_M) * 100), label: "徒歩10分" },
    ],
  };
}

export function mapCounts(rows) {
  return MAP_CATS.map((cat, ci) => ({ ...cat, n: rows.filter((r) => r[0] === ci).length }));
}

// 地図の下の一文。地図に載せた店（スーパー・コンビニ・ドラッグストア）が駅のどちら側に寄っているかを数えて書く。
// 載せているのは種類ごとに近い順の最大6か所なので、「地図に載せた店」と書き、地区全体の店の数とは言わない
export function mapSummaryText(stationName, rows) {
  const shops = rows.filter((r) => SHOP_CATS.includes(r[0]));
  if (shops.length < 4) {
    return shops.length === 0
      ? `${stationName}から徒歩10分（800m）以内には、地図データに登録されたスーパー・コンビニ・ドラッグストアがありません。`
      : `${stationName}から徒歩10分（800m）以内で地図データに登録されたスーパー・コンビニ・ドラッグストアは${shops.length}か所です。`;
  }
  const north = shops.filter((r) => r[1] > 0).length;
  const east = shops.filter((r) => r[2] > 0).length;
  const n = shops.length;
  const sides = [
    { name: "北", k: north },
    { name: "南", k: n - north },
    { name: "東", k: east },
    { name: "西", k: n - east },
  ].sort((a, b) => b.k - a.k);
  const top = sides[0];
  const near = shops.filter((r) => r[3] <= 400).length;
  const nearText =
    near === n ? "すべて徒歩5分（400m）以内です" : near === 0 ? "徒歩5分（400m）以内には1か所もありません" : `${near}か所が徒歩5分（400m）以内です`;
  if (top.k / n >= 0.75) {
    const which = top.k === n ? `${n}か所すべてが` : `${n}か所のうち${top.k}か所が`;
    return `地図に載せたスーパー・コンビニ・ドラッグストア${which}駅の${top.name}側にあり、${nearText}。`;
  }
  return `地図に載せたスーパー・コンビニ・ドラッグストア${n}か所は駅の周りに散らばっていて、${nearText}。`;
}
