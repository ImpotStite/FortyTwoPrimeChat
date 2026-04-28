import { useState, type ReactNode } from "react";

interface Props {
  className?: string;
  children?: ReactNode;
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const p = (node as { props?: { children?: ReactNode } }).props;
    return extractText(p?.children ?? null);
  }
  return "";
}

export function CodePre(props: Props) {
  const [copied, setCopied] = useState(false);
  const text = extractText(props.children);
  const lang = (() => {
    const cls =
      (props.children as { props?: { className?: string } } | undefined)?.props
        ?.className || "";
    const m = cls.match(/language-([\w-]+)/);
    return m?.[1];
  })();

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* empty */
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-lang">{lang || "code"}</span>
        <button type="button" className="code-copy" onClick={onCopy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className={props.className}>{props.children}</pre>
    </div>
  );
}
