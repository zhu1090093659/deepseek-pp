import { DEEPSEEK_API_URL } from '../constants';
import type { Memory, ToolCall } from '../types';
import { buildAugmentedPrompt } from '../memory/injector';
import { extractTextFromSSEData, isStreamFinished, parseSSEChunk } from './sse-parser';
import { extractToolCalls } from './tool-parser';

interface HookState {
  memories: Memory[];
  skills: Array<{ name: string; trigger: string; promptTemplate: string; memoryEnabled: boolean }>;
  onToolCall: (call: ToolCall) => void;
  onResponseComplete: (fullText: string) => void;
}

let hookState: HookState = {
  memories: [],
  skills: [],
  onToolCall: () => {},
  onResponseComplete: () => {},
};

export function updateHookState(partial: Partial<HookState>) {
  hookState = { ...hookState, ...partial };
}

export function installFetchHook() {
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!url.includes('/api/v0/chat/completion') || !init?.body) {
      return originalFetch.call(this, input, init);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init.body as string);
    } catch {
      return originalFetch.call(this, input, init);
    }

    const originalPrompt = (body.prompt as string) || '';

    const skillMatch = originalPrompt.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (skillMatch) {
      const [, skillName, args] = skillMatch;
      const skill = hookState.skills.find((s) => s.trigger === `/${skillName}`);
      if (skill) {
        let prompt = skill.promptTemplate.replace(/\{\{content\}\}/g, args.trim());
        if (skill.memoryEnabled && hookState.memories.length > 0) {
          const { augmented } = buildAugmentedPrompt(prompt, hookState.memories);
          prompt = augmented;
        }
        body.prompt = prompt;
        init = { ...init, body: JSON.stringify(body) };
        return interceptResponse(originalFetch.call(this, input, init));
      }
    }

    if (hookState.memories.length > 0) {
      const { augmented, usedMemoryIds } = buildAugmentedPrompt(originalPrompt, hookState.memories);
      body.prompt = augmented;
      init = { ...init, body: JSON.stringify(body) };

      window.postMessage({
        source: 'deepseek-pp-main',
        type: 'MEMORIES_USED',
        ids: usedMemoryIds,
      });
    }

    return interceptResponse(originalFetch.call(this, input, init));
  };
}

async function interceptResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  const stream = new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const toolCalls = extractToolCalls(fullText);
          for (const call of toolCalls) {
            hookState.onToolCall(call);
          }
          hookState.onResponseComplete(fullText);
          controller.close();
          break;
        }

        controller.enqueue(value);

        const chunk = decoder.decode(value, { stream: true });
        const events = parseSSEChunk(chunk);
        for (const event of events) {
          const text = extractTextFromSSEData(event.data);
          if (text) fullText += text;

          if (isStreamFinished(event.data)) {
            const toolCalls = extractToolCalls(fullText);
            for (const call of toolCalls) {
              hookState.onToolCall(call);
            }
            hookState.onResponseComplete(fullText);
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
