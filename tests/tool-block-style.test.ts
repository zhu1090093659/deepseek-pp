import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('content tool block styles', () => {
  it('keeps restored tool detail content scrollable for long source output', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');
    const rule = source.match(/\.dpp-tool-block-item-detail \{([\s\S]*?)\n    \}/)?.[1] ?? '';

    expect(rule).toContain('max-height:');
    expect(rule).toContain('overflow: auto;');
    expect(rule).toContain('overscroll-behavior: contain;');
  });

  it('renders artifact results outside the collapsible executed-tools block', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('.dpp-artifact-results');
    expect(source).toContain('function renderDetachedArtifactResults(');
    expect(source).toContain('isDetachedArtifactToolResult(exec.result)');
    expect(source).toContain('renderDetachedArtifactResultsForBlock(session, toolBlockEl);');
    expect(source).toContain('renderDetachedArtifactResults(target, record.id, executions, block);');
    expect(source).toContain('responseHost.insertBefore(container, anchor);');
  });

  it('keeps rendered tool cleanup bounded for large message bodies', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('CLEANABLE_TEXT_DEEP_SCAN_MAX_CHARS');
    expect(source).toContain('CLEANUP_MESSAGE_SCAN_LIMIT');
    expect(source).toContain('hasLikelyToolMarkerPrefix');
    expect(source).toContain('if (i < minIndex) break;');
  });

  it('uses the shared injected theme variables for readable tool block text', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("import { injectInjectedThemeStyles } from '../core/ui/injected-theme';");
    expect(source).toContain('injectInjectedThemeStyles();');
    expect(source).toContain('color: var(--dpp-ui-text);');
    expect(source).toContain('color: var(--dpp-ui-text-muted);');
    expect(source).not.toContain('body.dpp-theme-dark .dpp-tool-block-item { color: rgb(200, 200, 200); }');
  });

  it('mounts inline agent output after DeepSeek final answer content instead of the reasoning block', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("const ASSISTANT_RESPONSE_CONTENT_SELECTOR = '._74c0879, .ds-assistant-message-main-content';");
    expect(source).toContain('function mountInlineAgentContainer(message: Element, container: HTMLElement): void');
    expect(source).toContain('inlineAgentContainerObserver.observe(message, { childList: true, subtree: true });');
    expect(source).not.toContain('inlineAgentContainerObserver.observe(responseHost, { childList: true });');
  });

  it('scopes task_complete cleanup to assistant body text outside code blocks', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('function shouldReplaceRenderedTaskCompleteBlock(textNode: Text): boolean');
    expect(source).toContain("if (parent.closest('pre, code')) return false;");
    expect(source).toContain("const message = parent.closest('.ds-message');");
    expect(source).toContain('return getAssistantContentHosts(message).some((host) => host.contains(parent));');
  });

  it('normalizes restored inline-agent traces that predate finalText storage', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("(trace.finalText === undefined || typeof trace.finalText === 'string')");
    expect(source).toContain("const finalText = typeof trace.finalText === 'string' ? trace.finalText : '';");
    expect(source).toContain("finalText: clampText(finalText, INLINE_AGENT_FINAL_RENDER_MAX_CHARS) ?? '',");
  });

  it('hides internal inline-agent continuation user messages instead of rendering empty turns', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('startInlineAgentContinuationMessageHider();');
    expect(source).toContain('INLINE_AGENT_CONTINUATION_PLACEHOLDER');
    expect(source).toContain('isInlineAgentContinuationStructure(text)');
    expect(source).toContain('hideInlineAgentContinuationMessages(root);');
    expect(source).toContain("message.style.display = 'none';");
    expect(source).toContain("data-dpp-hidden-inline-agent-continuation");
  });

  it('keeps permission banner text on the same injected theme contract', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');
    const rule = source.match(/\.dpp-permission-banner \{([\s\S]*?)\n    \}/)?.[1] ?? '';

    expect(rule).toContain('background: var(--dpp-ui-surface);');
    expect(rule).toContain('color: var(--dpp-ui-text);');
    expect(source).not.toContain('var(--ds-text');
    expect(source).not.toContain('var(--ds-text-secondary');
  });
});
