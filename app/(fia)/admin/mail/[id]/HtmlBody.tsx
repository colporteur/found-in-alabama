"use client";

// Renders an HTML email in a fully sandboxed iframe: no scripts, no
// same-origin access to the admin, and a CSP that blocks remote images
// (tracking pixels) until "Load images" is clicked. Links open in a new tab.

import { useEffect, useRef, useState } from "react";

export default function HtmlBody({ html }: { html: string }) {
  const [remote, setRemote] = useState(false);
  const [height, setHeight] = useState(600);
  const ref = useRef<HTMLIFrameElement>(null);

  const imgSrc = remote ? "img-src data: cid: https: http:;" : "img-src data: cid:;";
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; font-src data:;">
<base target="_blank">
<style>body{margin:0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1A1A1A;word-wrap:break-word}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;

  // allow-same-origin lets us measure the content height; scripts stay
  // blocked (no allow-scripts), so the email can't use that access.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const measure = () => {
      try {
        const h = frame.contentDocument?.documentElement.scrollHeight;
        if (h) setHeight(Math.min(Math.max(h + 16, 200), 6000));
      } catch {
        /* ignore */
      }
    };
    frame.addEventListener("load", measure);
    const t = setTimeout(measure, 800);
    return () => {
      frame.removeEventListener("load", measure);
      clearTimeout(t);
    };
  }, [doc]);

  return (
    <div>
      {!remote && /<img[^>]+src=["']?https?:/i.test(html) && (
        <div className="mb-3 text-sm bg-brand-paper border border-brand-ink/10 rounded px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-brand-ink/70">Remote images are blocked.</span>
          <button type="button" onClick={() => setRemote(true)} className="underline">
            Load images
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        title="Message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        style={{ width: "100%", height, border: 0 }}
      />
    </div>
  );
}
