import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

// Custom code renderer that pipes content through highlight.js. We use
// `lib/common` to avoid pulling all 190+ language grammars; the common
// bundle covers js/ts/python/rust/go/sh/json/yaml/md and is ~50 KB
// gzipped.
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  let highlighted = "";
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    try {
      highlighted = hljs.highlightAuto(text).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  }
  return `<pre><code class="hljs language-${escapeAttr(lang ?? "")}">${highlighted}</code></pre>`;
};

marked.setOptions({
  gfm: true,
  breaks: false,
  renderer,
});

// `breaks: false` matches GitHub flavor — single newlines inside a
// paragraph stay as a space. Most LLM output uses double-newlines for
// paragraph breaks, so this looks right.

// Render markdown → trusted HTML. DOMPurify wipes anything that could
// execute (script tags, on-event attributes, javascript: URLs), and we
// allow exactly the tag set markdown can produce so the caller can
// safely set innerHTML.
export function renderMarkdown(src: string): string {
  const dirty = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(dirty, {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(s: string): string {
  return s.replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
