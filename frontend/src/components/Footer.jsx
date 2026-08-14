import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="app-footer">
      <Link to="/guide">使い方・スコアの見方</Link>
      <Link to="/about">運営者情報</Link>
      <Link to="/privacy">プライバシーポリシー・利用規約</Link>
    </footer>
  );
}
