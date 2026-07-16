// 広告枠のプレースホルダー。AdSense等の審査が通るまではダミー枠のみ表示する
// （ikebukuro-locker-appのAdSlot.jsxと同じ考え方）。
export default function AdSlot() {
  return (
    <div className="ad-slot" aria-hidden="true">
      広告枠（準備中）
    </div>
  );
}
