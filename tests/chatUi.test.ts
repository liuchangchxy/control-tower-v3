import { describe, expect, it } from 'vitest';
import { createChatStreamParser } from '../client/src/lib/chatStream.js';
import { renderMarkdown } from '../client/src/lib/markdown.js';

describe('chat stream parser', () => {
  it('handles split frames, reasoning, content, and done', () => {
    const parser = createChatStreamParser();
    expect(parser.push('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n')).toMatchObject([{ delta: { reasoning_content: 'think' } }]);
    expect(parser.push('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n')).toMatchObject([{ delta: { content: 'answer' } }]);
    expect(parser.push('data: [DO')).toEqual([]);
    expect(parser.push('NE]\n\n')).toEqual([{ delta: {}, done: true }]);
  });
});

describe('safe markdown renderer', () => {
  it('escapes raw HTML and renders code', () => {
    const output = renderMarkdown('# hi\n\n```ts\nconst x = 1;\n```\n\n<script>alert(1)</script>');
    expect(output).toContain('<h1>hi</h1>');
    expect(output).toContain('chat-code');
    expect(output).not.toContain('<script>');
  });
});
