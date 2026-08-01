import { useEffect } from "react";

// ページ遷移時に title / meta description を書き換える。
//
// ビルド時のプリレンダ（scripts/prerender.js）が各URLの初期HTMLに正しいtitleを埋めているが、
// アプリ内での遷移（駅セレクトの切り替え等）はJSだけで行われるためHTMLは差し替わらない。
// これが無いと、駅を切り替えたときにtitleが前の駅のままになる。
//
// 文言はプリレンダと同じ src/pageMeta.js から取ること。
export function useDocumentMeta(title, description) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) {
      let tag = document.querySelector('meta[name="description"]');
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", "description");
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", description);
    }
  }, [title, description]);
}
