import type { Extension } from "@codemirror/state";

import { EDITOR_MAX_BYTES, type FileEntry } from "./api";

/** Anything matching one of these MIME prefixes is treated as editable text. */
const EDITABLE_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-toml",
  "application/x-sh",
  "application/x-python",
];

/** File extensions we treat as editable when the server didn't infer a MIME. */
const EDITABLE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "json",
  "yml",
  "yaml",
  "toml",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "swift",
  "rb",
  "php",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "sh",
  "bash",
  "zsh",
  "sql",
  "csv",
  "xml",
  "env",
  "ini",
  "conf",
  "cfg",
  "log",
  "diff",
  "patch",
  "lock",
  "gitignore",
  "dockerfile",
  "makefile",
]);

export type EditableVerdict =
  | { editable: true }
  | { editable: false; reason: "directory" | "too-large" | "binary" };

/**
 * Decide whether the Files drawer's ✎ button should be enabled for an
 * entry, without round-tripping the file body. The real UTF-8 check
 * still happens inside `loadFileContent` once we actually open it.
 */
export function classifyForEditor(entry: FileEntry): EditableVerdict {
  if (entry.isDir) return { editable: false, reason: "directory" };
  if (entry.sizeBytes > EDITOR_MAX_BYTES) {
    return { editable: false, reason: "too-large" };
  }
  if (entry.mime && mimeLooksEditable(entry.mime)) {
    return { editable: true };
  }
  // Fall back to extension when the server returned no mime (a lot of
  // workspace files won't have a recognized extension in `infer_mime`,
  // so we shouldn't gate purely on that). Unknown extensions get an
  // optimistic green light — the GET handler still gets the final say
  // via its own NUL-byte / UTF-8 sniff.
  const ext = extensionOf(entry.name);
  if (ext && EDITABLE_EXTENSIONS.has(ext)) return { editable: true };
  if (!entry.mime) return { editable: true };
  return { editable: false, reason: "binary" };
}

function mimeLooksEditable(mime: string): boolean {
  const trimmed = mime.split(";")[0]!.trim().toLowerCase();
  return EDITABLE_MIME_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Resolve a CodeMirror language extension for the given filename, lazy
 * loading the lang package on demand. Falls back to `null` (plain
 * text) for anything we don't recognise — CodeMirror still renders
 * normally, just without highlighting.
 */
export async function loadLanguageExtension(name: string): Promise<Extension | null> {
  const ext = extensionOf(name);
  if (!ext) return null;
  switch (ext) {
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: ext.endsWith("x") });
    case "ts":
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
        jsx: ext === "tsx",
      });
    case "md":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "html":
    case "htm":
      return (await import("@codemirror/lang-html")).html();
    case "css":
    case "scss":
    case "less":
      return (await import("@codemirror/lang-css")).css();
    default:
      return null;
  }
}

/**
 * Build a Save & Run prompt for the current thread. Kept here so the
 * exact wording is one place to tweak.
 */
export function buildRunPrompt(path: string): string {
  return `请运行 workspace 里的 \`${path}\` 并把结果（含 stdout/stderr/产物）直接贴回来。`;
}
