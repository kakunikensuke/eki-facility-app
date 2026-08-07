// 徒歩分数の段階（backend/batch/updateFacilityCounts.js の WALK_MINUTES_TIERS と
// 一致させる規約）。フロント/バックエンドでビルドルートが分かれているため値を複製している。
export const WALK_MINUTES_TIERS = [5, 10, 15, 20];

// 初期表示の段階。4段階化(2026-08-07)以前の唯一の集計範囲であり、
// 住みやすさスコアの説明文・OGP・meta descriptionもこの段階を基準にしている。
export const DEFAULT_WALK_MINUTES = 10;

export const WALK_SPEED_M_PER_MIN = 80;
