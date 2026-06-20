// Render a newsletter draft (markdown body) into the actual HTML + plain
// text payloads we send via Resend. Email clients strip <style> tags
// and most CSS, so everything important is INLINE on the elements.
//
// The HTML template is mobile-friendly: 600px max width, single column,
// large tappable buttons, safe web fonts only (Inter / Permanent Marker
// fall back to system stacks since Google Fonts won't load in Gmail).

import { marked } from "marked";
import { unsubscribeUrl } from "@/lib/newsletter";

const BUSINESS_NAME = "Found in Alabama";
// CAN-SPAM requires a real postal address in marketing emails. We let
// the operator override via env; otherwise we fall back to a regional
// hint that doesn't reveal a specific sourcing town.
function businessAddress(): string {
  return (
    process.env.NEWSLETTER_BUSINESS_ADDRESS ??
    "Found in Alabama · Central Alabama, USA"
  );
}

/** Strip markdown into a passable plain-text rendering for the
 *  text/plain part. Not perfect — just clean enough for grep + spam
 *  filters that prefer to see plain text. */
export function markdownToPlainText(md: string, unsubscribeHref: string): string {
  const collapsed = md
    .replace(/^#{1,6}\s+/gm, "") // strip heading hashes
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold** → bold
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1") // *italic* → italic
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    // [text](url) → "text (url)"
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return `${collapsed}\n\n— ${BUSINESS_NAME}\n\n${businessAddress()}\nUnsubscribe: ${unsubscribeHref}`;
}

/** Wrap rendered HTML body in the branded email template. */
function wrapHtml(bodyHtml: string, unsubscribeHref: string, preheader: string): string {
  // Common email-safe styles
  const tableStyle =
    "max-width:600px; margin:0 auto; background:#fff; border:1px solid #e5e1d5; border-radius:8px;";
  const bodyStyle =
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#f8f5ee; color:#1c1a17; padding:24px 16px; margin:0;";
  const wordmarkStyle =
    "font-family:'Permanent Marker','Comic Sans MS',cursive; font-weight:400; font-size:28px; line-height:1; letter-spacing:0.5px; margin:0; color:#1c1a17;";
  const yellowHighlight =
    "background:#f4c430; color:#1c1a17; padding:2px 8px 4px; border-radius:4px;";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${BUSINESS_NAME} newsletter</title>
</head>
<body style="${bodyStyle}">
<!-- preheader: hidden in body but shown as inbox preview -->
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f8f5ee;">${escapeHtml(preheader)}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="${tableStyle}">
  <tr><td style="padding:32px 32px 8px;">
    <p style="${wordmarkStyle}">Found in <span style="${yellowHighlight}">Alabama</span></p>
    <p style="font-size:12px; letter-spacing:0.1em; text-transform:uppercase; color:#857f72; margin:12px 0 0;">Monthly newsletter</p>
  </td></tr>

  <tr><td style="padding:8px 32px 24px; border-bottom:1px solid #f0ebdf;">
    <div style="font-size:16px; line-height:1.6;">
      ${bodyHtml}
    </div>
  </td></tr>

  <tr><td style="padding:0 32px 24px;">
    <div style="background:#f4c430; border-radius:6px; padding:16px 18px; color:#1c1a17;">
      <p style="margin:0 0 6px; font-weight:600; font-size:15px;">
        Got something to sell?
      </p>
      <p style="margin:0; font-size:14px; line-height:1.5;">
        We&rsquo;re always on the lookout for new inventory — estates, collections, one-off boxes you’re ready to move. Text photos to <a href="sms:+12566841253" style="color:#1c1a17; text-decoration:underline;">256-684-1253</a> and we’ll take a look.
      </p>
    </div>
  </td></tr>

  <tr><td style="padding:24px 32px 32px; font-size:13px; line-height:1.55; color:#857f72;">
    <p style="margin:0 0 12px;">${escapeHtml(businessAddress())}</p>
    <p style="margin:0 0 4px;">
      Don&rsquo;t want these? <a href="${unsubscribeHref}" style="color:#857f72; text-decoration:underline;">Unsubscribe here</a>.
    </p>
    <p style="margin:0; font-size:12px; color:#a09c92;">
      You&rsquo;re receiving this because you confirmed your email at foundinalabama.com.
    </p>
  </td></tr>
</table>

</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline-style the rendered markdown so email clients don't strip layout. */
function inlineMarkdownStyles(html: string): string {
  return html
    .replace(/<h1\b/g, '<h1 style="font-family:\'Permanent Marker\',\'Comic Sans MS\',cursive; font-size:26px; line-height:1.15; margin:24px 0 12px; color:#1c1a17;"')
    .replace(/<h2\b/g, '<h2 style="font-family:\'Permanent Marker\',\'Comic Sans MS\',cursive; font-size:22px; line-height:1.2; margin:28px 0 10px; color:#1c1a17;"')
    .replace(/<h3\b/g, '<h3 style="font-size:17px; font-weight:600; margin:20px 0 8px; color:#1c1a17;"')
    .replace(/<p\b/g, '<p style="margin:0 0 14px; color:#1c1a17;"')
    .replace(/<ul\b/g, '<ul style="margin:0 0 14px; padding-left:22px;"')
    .replace(/<ol\b/g, '<ol style="margin:0 0 14px; padding-left:22px;"')
    .replace(/<li\b/g, '<li style="margin:0 0 6px;"')
    .replace(/<a\b/g, '<a style="color:#1c1a17; text-decoration:underline; text-decoration-color:#f4c430; text-decoration-thickness:2px;"')
    .replace(/<strong\b/g, '<strong style="font-weight:600;"')
    .replace(/<em\b/g, '<em style="font-style:italic;"')
    .replace(/<blockquote\b/g, '<blockquote style="border-left:3px solid #f4c430; padding-left:14px; margin:14px 0; color:#65615a;"')
    .replace(/<img\b/g, '<img style="display:block; width:100%; max-width:536px; height:auto; border-radius:6px; margin:8px auto 18px;"');
}

export type RenderedEmail = {
  html: string;
  text: string;
};

export function renderNewsletterEmail({
  markdownBody,
  preheader,
  unsubscribeRawToken,
}: {
  markdownBody: string;
  preheader: string;
  unsubscribeRawToken: string;
}): RenderedEmail {
  const unsubHref = unsubscribeUrl(unsubscribeRawToken);
  const renderedMd = marked.parse(markdownBody, { async: false }) as string;
  const styled = inlineMarkdownStyles(renderedMd);
  const html = wrapHtml(styled, unsubHref, preheader);
  const text = markdownToPlainText(markdownBody, unsubHref);
  return { html, text };
}
