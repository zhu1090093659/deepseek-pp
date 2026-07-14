import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contentSource = readFileSync('entrypoints/content.ts', 'utf8');
const mainWorldSource = readFileSync('entrypoints/main-world.content.ts', 'utf8');

describe('Content controller ownership contract', () => {
  it('keeps one explicit controller per migrated DOM capability', () => {
    for (const id of [
      'theme',
      'mutation-hub',
      'token-speed',
      'tool',
      'inline-agent',
      'multimodal',
      'export',
      'history',
      'project',
      'ux-polish',
      'background',
      'pet',
    ]) {
      expect(contentSource).toContain(`createDomCapability('${id}'`);
    }
    expect(contentSource).not.toContain("createDomCapability('tool-inline-chat'");
    expect(contentSource).not.toContain("createDomCapability('multimodal-export'");
    expect(contentSource).not.toContain("createDomCapability('history-project-ux'");
  });

  it('routes token and tool refresh through one event-driven navigation owner', () => {
    expect(mainWorldSource).toContain('createMainWorldNavigationController({');
    expect(mainWorldSource).toContain("bridge.post({ type: 'NAVIGATION_CHANGED' });");
    expect(contentSource).toContain("case 'NAVIGATION_CHANGED':");
    expect(contentSource).toContain("window.dispatchEvent(new Event('dpp:navigation'));");
    expect(contentSource).not.toContain('TOKEN_SPEED_ROUTE_CHECK_MS');
    expect(contentSource).not.toContain('TOOL_BLOCK_ROUTE_CHECK_MS');
    expect(contentSource).not.toContain('tokenSpeedRouteTimer');
    expect(contentSource).not.toContain('toolBlockRouteTimer');
  });

  it('routes both worlds through the shared document lifecycle instead of entrypoint listeners', () => {
    expect(contentSource).toContain('replaceContentDocumentLifecycle({');
    expect(mainWorldSource).toContain('replaceContentDocumentLifecycle({');
    expect(contentSource).not.toContain("window.addEventListener('pagehide'");
    expect(mainWorldSource).not.toContain("window.addEventListener('pagehide'");
  });

  it('removes capability-owned transient UI and resolves permission waits during teardown', () => {
    expect(contentSource).toContain('finishActivePermissionRequest(false);');
    expect(contentSource).toContain("document.querySelectorAll('.dpp-tool-block, .dpp-artifact-results')");
    expect(contentSource).toContain('removeInlineAgentStyles();');
    expect(contentSource).toContain("document.querySelectorAll('[data-dpp-transparent]')");
  });
});
