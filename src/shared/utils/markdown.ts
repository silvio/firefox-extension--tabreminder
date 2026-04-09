function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeMarkdownUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function renderMarkdown(text: string): string {
  const codeBlocks: string[] = [];
  const images: string[] = [];
  const links: string[] = [];

  let processedText = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    const safeLang = escapeHtml(lang);
    const langClass = safeLang ? ` data-lang="${safeLang}"` : '';
    const langLabel = safeLang
      ? `<div style="font-size:10px;color:#888;margin-bottom:4px">${safeLang}</div>`
      : '';
    codeBlocks.push(
      `<div style="background:#1e1e1e;padding:8px 12px;border-radius:4px;margin:8px 0;overflow-x:auto">${langLabel}<pre style="margin:0;font-family:monospace;font-size:12px;white-space:pre-wrap"${langClass}>${escapeHtml(code.trim())}</pre></div>`
    );
    return placeholder;
  });

  processedText = processedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const placeholder = `@@IMAGE_${images.length}@@`;
    const safeUrl = sanitizeMarkdownUrl(url);
    const safeAlt = escapeHtml(alt);

    images.push(
      safeUrl
        ? `<img src="${escapeHtml(safeUrl)}" alt="${safeAlt}" style="max-width:100%;height:auto;border-radius:4px;margin:4px 0" />`
        : safeAlt
    );

    return placeholder;
  });

  processedText = processedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const placeholder = `@@LINK_${links.length}@@`;
    const safeUrl = sanitizeMarkdownUrl(url);
    const safeLabel = escapeHtml(label);

    links.push(
      safeUrl
        ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:#4a90d9">${safeLabel}</a>`
        : safeLabel
    );

    return placeholder;
  });

  let html = escapeHtml(processedText);

  codeBlocks.forEach((block, i) => {
    html = html.replace(`@@CODE_BLOCK_${i}@@`, block);
  });

  images.forEach((image, i) => {
    html = html.replace(`@@IMAGE_${i}@@`, image);
  });

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  html = html.replace(/`([^`]+)`/g, '<code style="background:#333;padding:2px 4px;border-radius:3px;font-family:monospace">$1</code>');

  html = html.replace(/^### (.+)$/gm, '<div style="font-size:14px;font-weight:600;margin:8px 0 4px">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div style="font-size:15px;font-weight:600;margin:8px 0 4px">$1</div>');
  html = html.replace(/^# (.+)$/gm, '<div style="font-size:16px;font-weight:600;margin:8px 0 4px">$1</div>');

  html = html.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid #666;padding-left:10px;margin:4px 0;color:#aaa">$1</div>');

  html = html.replace(/^[-*] (.+)$/gm, '<div style="padding-left:12px">• $1</div>');
  html = html.replace(/^\d+\. (.+)$/gm, '<div style="padding-left:12px">$1</div>');

  links.forEach((link, i) => {
    html = html.replace(`@@LINK_${i}@@`, link);
  });

  return html;
}

export { escapeHtml, sanitizeMarkdownUrl };
