const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4001";

export async function fetchStations() {
  const res = await fetch(`${API_BASE}/api/stations`);
  if (!res.ok) throw new Error("駅一覧の取得に失敗しました");
  return res.json();
}

// トップページのランキング用。全駅の既定段階（徒歩10分）のスコアがスコア降順で返る
export async function fetchStationScores() {
  const res = await fetch(`${API_BASE}/api/station-scores`);
  if (!res.ok) throw new Error("スコア一覧の取得に失敗しました");
  return res.json();
}

export async function fetchFacilityCounts(stationSlug) {
  const res = await fetch(
    `${API_BASE}/api/facility-counts?station=${encodeURIComponent(stationSlug)}`
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error("店舗数データの取得に失敗しました");
  }
  return res.json();
}
