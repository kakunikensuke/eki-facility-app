import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="app-footer">
      <Link to="/privacy">プライバシーポリシー・利用規約</Link>
    </footer>
  );
}
