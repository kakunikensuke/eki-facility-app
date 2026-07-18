import { useEffect, useState } from "react";

// お気に入り駅はログイン・サーバー保存を持たず、ブラウザのlocalStorageのみに保存する
// （要件定義書8.1.3参照）。同一タブ内の複数コンポーネント（駅ページの★・お気に入り一覧）を
// 同期させるため、変更時にカスタムイベントを発火して購読側に再読込させる。
const STORAGE_KEY = "eki-facility-favorites";
const EVENT_NAME = "eki-facility-favorites-changed";

function readFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeFavorites(slugs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function toggleFavorite(slug) {
  const current = readFavorites();
  const next = current.includes(slug)
    ? current.filter((s) => s !== slug)
    : [...current, slug];
  writeFavorites(next);
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(readFavorites);

  useEffect(() => {
    const handler = () => setFavorites(readFavorites());
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return favorites;
}
