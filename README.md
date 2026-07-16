# 住みやすさ駅前スコア

駅名を選ぶと、周辺（徒歩10分圏内）のコンビニ・病院・スーパー・飲食店の店舗数がカテゴリ別にわかるWebアプリ。

詳細は[要件定義書.md](./要件定義書.md)・[設計書.md](./設計書.md)・[CLAUDE.md](./CLAUDE.md)参照。

## 使用技術

- フロントエンド: React + Vite + react-router-dom
- バックエンド: Node.js + Express + node-cron
- データ取得元: OpenStreetMap Overpass API（無料・ODbLライセンス）

## セットアップ・起動

### バックエンド

```
cd backend
npm install
npm run dev            # http://localhost:4001
```

### フロントエンド

```
cd frontend
npm install
npm run dev             # http://localhost:5173
```

### 集計バッチの手動実行

Overpass APIから対象駅の店舗数を再取得し、`backend/data/facility-counts.json`を更新する。

```
cd backend
npm run update:facility-counts
```

バックエンドサーバー起動中は、デフォルトで毎日3:00(JST)に自動実行される（`FACILITY_UPDATE_CRON`環境変数で変更可）。

## 対象駅（初期7駅）

池袋・新宿・渋谷・東京・品川・上野・横浜（`ikebukuro-locker-app`と同じ駅、`backend/data/stations.json`参照）

## ライセンス・出典表示について

店舗数データはOpenStreetMapのOverpass APIから取得している。ODbLライセンスに基づき、画面上に「地図データ: © OpenStreetMap contributors」の出典表示を必須としている（`frontend/src/pages/StationPage.jsx`参照）。
