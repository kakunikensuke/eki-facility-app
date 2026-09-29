// データの取得元。
//
// 2026-08-15にRenderのバックエンド（backend/server.js）呼び出しをやめ、
// ビルド時に生成した静的JSON（scripts/generateApiData.js が public/api/ に出力）を
// 読むように変えた。サーバーは静的JSONを読んで決まった計算をするだけで動的な処理が
// 無く、Renderの無料枠（アカウント単位で月750インスタンス時間）をロッカーアプリと
// 2サービスで奪い合って15.6日で使い切る状態だったため。
// 副次的にコールドスタートが消え、CDN配信になって速くなっている。
const API_BASE = "/api";

// Cloudflare PagesはSPAフォールバックで、存在しないパスにも200でindex.htmlを返す。
// ステータスだけでは「データが無い」を判定できないので、JSONが返ったかまで見る。
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  if (!(response.headers.get("content-type") || "").includes("application/json")) return null;
  return response.json();
}

export async function fetchStations() {
  const stations = await fetchJson(`${API_BASE}/stations.json`);
  if (!stations) throw new Error("駅一覧の取得に失敗しました");
  return stations;
}

// トップページのランキング用。全駅の既定段階（徒歩10分）のスコアがスコア降順で返る
export async function fetchStationScores() {
  const scores = await fetchJson(`${API_BASE}/station-scores.json`);
  if (!scores) throw new Error("スコア一覧の取得に失敗しました");
  return scores;
}

// 条件検索・目的別ランキング用。全駅×全段階の軒数（scripts/stationMatrix.js）。
// トップと検索ページの行き来で読み直さないよう、1度読んだものを使い回す
let matrixPromise = null;
export function fetchStationMatrix() {
  if (!matrixPromise) {
    matrixPromise = fetchJson(`${API_BASE}/station-matrix.json`).then((matrix) => {
      if (!matrix) throw new Error("駅データの取得に失敗しました");
      return matrix;
    });
    // 失敗したときは次の呼び出しで取り直せるようにする
    matrixPromise.catch(() => {
      matrixPromise = null;
    });
  }
  return matrixPromise;
}

// トップの背景用。全駅の写真の最初の数枚と帰属表示（scripts/stationBundle.js の photosLite）
export async function fetchPhotosLite() {
  const photos = await fetchJson(`${API_BASE}/station-photos-lite.json`);
  if (!photos) throw new Error("写真一覧の取得に失敗しました");
  return photos;
}

// 集計データがまだ無い駅はファイルそのものが存在しない。呼び出し側は
// nullを「この駅の集計データはまだ準備できていません」として扱う。
export async function fetchFacilityCounts(stationSlug) {
  return fetchJson(`${API_BASE}/facility-counts/${encodeURIComponent(stationSlug)}.json`);
}
