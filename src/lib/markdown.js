export const renderMarkdownToHtml = (markdown) => {
  if (!markdown) return "";

  let html = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```([\s\S]*?)```/g, (match, code) => (
    `<pre class="markdown-code"><code>${code.trim()}</code></pre>`
  ));
  html = html.replace(/^\s*&gt;\s*(.+)$/gm, '<blockquote class="markdown-blockquote">$1</blockquote>');
  html = html.replace(/^\s*###\s+(.+)$/gm, '<h3 class="markdown-h3">$1</h3>');
  html = html.replace(/^\s*##\s+(.+)$/gm, '<h2 class="markdown-h2">$1</h2>');
  html = html.replace(/^\s*#\s+(.+)$/gm, '<h1 class="markdown-h1">$1</h1>');
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code class="markdown-inline-code">$1</code>');

  let inList = false;
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*[-*]\s+(.+)$/);
    if (match) {
      lines[i] = inList
        ? `<li>${match[1]}</li>`
        : `<ul class="markdown-list"><li>${match[1]}</li>`;
      inList = true;
    } else if (inList) {
      lines[i - 1] += "</ul>";
      inList = false;
    }
  }
  if (inList) lines[lines.length - 1] += "</ul>";
  html = lines.join("\n");

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="markdown-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.split(/\n\n+/).map((part) => {
    const trimmed = part.trim();
    if (
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<pre") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<ul") ||
      trimmed.startsWith("</ul")
    ) {
      return part;
    }
    return `<p class="markdown-p">${part.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");

  return html;
};
