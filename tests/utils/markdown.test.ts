import { renderMarkdown, sanitizeMarkdownUrl } from '../../src/shared/utils/markdown';

describe('markdown rendering', () => {
  it('allows https links', () => {
    const html = renderMarkdown('[Open](https://example.com/path?q=1)');

    expect(html).toContain('<a href="https://example.com/path?q=1"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('allows https images', () => {
    const html = renderMarkdown('![Screenshot](https://example.com/image.png)');

    expect(html).toContain('<img src="https://example.com/image.png"');
    expect(html).toContain('alt="Screenshot"');
  });

  it('renders unsafe links as inert text', () => {
    const html = renderMarkdown('[Run](javascript:alert(1))');

    expect(html).toContain('Run');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
  });

  it('renders unsafe images without carrying injected attributes', () => {
    const html = renderMarkdown('![x](x" onerror="alert(1))');

    expect(html).toContain('x');
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('onerror=');
  });

  it('escapes user-controlled code fence language labels', () => {
    const html = renderMarkdown('```x" data-bad="1\ncode\n```');

    expect(html).toContain('&quot; data-bad=&quot;1');
    expect(html).not.toContain('data-bad="1"');
  });
});

describe('sanitizeMarkdownUrl', () => {
  it('rejects non-http protocols', () => {
    expect(sanitizeMarkdownUrl('data:text/html,hi')).toBeNull();
    expect(sanitizeMarkdownUrl('javascript:alert(1)')).toBeNull();
  });
});
