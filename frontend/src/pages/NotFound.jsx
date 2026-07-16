import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="not-found">
      <h1>ページが見つかりません</h1>
      <p>指定された駅は対象外か、URLが正しくありません。</p>
      <Link to="/ikebukuro">トップに戻る</Link>
    </div>
  );
}
