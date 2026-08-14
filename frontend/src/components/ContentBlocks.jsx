// content/pages.js のブロック配列を描画する。
// 同じブロックからプリレンダ側もHTMLを組む（scripts/prerender.js の blocksToHtml）。
// 型を増やすときは必ず両方に足すこと。片方だけだと画面と静的HTMLの中身がズレる。
export default function ContentBlocks({ blocks }) {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "h2":
        return <h2 key={i}>{block.text}</h2>;
      case "p":
        return <p key={i}>{block.text}</p>;
      case "ul":
        return (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        );
      case "qa":
        return (
          <p key={i}>
            <strong>{block.q}</strong>
            <br />
            {block.a}
          </p>
        );
      case "link":
        return (
          <p key={i}>
            {block.note ? `${block.note} ` : ""}
            <a href={block.href} target="_blank" rel="noreferrer">
              {block.text}
            </a>
          </p>
        );
      default:
        return null;
    }
  });
}
