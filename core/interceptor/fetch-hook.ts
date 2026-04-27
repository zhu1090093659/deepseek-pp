import { DEEPSEEK_API_URL } from '../constants';
import type { Memory, ToolCall } from '../types';
import { buildAugmentedPrompt } from '../memory/injector';
import { parseSkillCommand } from '../skill/parser';
import { extractTextFromParsed, isStreamFinishedFromParsed, parseSSEChunk, parseSSEData } from './sse-parser';
import { extractToolCalls } from './tool-parser';

const API_PATH = new URL(DEEPSEEK_API_URL).pathname;

interface HookState {
  memories: Memory[];
  skills: Array<{ name: string; instructions: string; memoryEnabled: boolean }>;
  onToolCall: (call: ToolCall) => void;
  onResponseComplete: (fullText: string) => void;
  onMemoriesUsed: (ids: number[]) => void;
}

let hookState: HookState = {
  memories: [],
  skills: [],
  onToolCall: () => {},
  onResponseComplete: () => {},
  onMemoriesUsed: () => {},
};

export function updateHookState(partial: Partial<HookState>) {
  hookState = { ...hookState, ...partial };
}

export function installFetchHook() {
  hookFetch();
  hookXHR();
}

function hookFetch() {
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!isChatCompletionURL(url) || !init?.body) {
      return originalFetch.call(this, input, init);
    }

    const modified = modifyRequestBody(init.body as string);
    if (!modified) return originalFetch.call(this, input, init);

    init = { ...init, body: modified };
    return interceptFetchResponse(originalFetch.call(this, input, init));
  };
}

function hookXHR() {
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    xhrUrls.set(this, typeof url === 'string' ? url : url.href);
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const url = xhrUrls.get(this);
    if (url && isChatCompletionURL(url) && typeof body === 'string') {
      const modified = modifyRequestBody(body);
      if (modified) {
        setupXHRResponseInterceptor(this);
        return origSend.call(this, modified);
      }
    }
    return origSend.call(this, body);
  };
}

function isChatCompletionURL(url: string): boolean {
  return url.includes(API_PATH);
}

function modifyRequestBody(bodyStr: string): string | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }

  const originalPrompt = (body.prompt as string) || '';
  if (!originalPrompt) return null;

  const invocation = parseSkillCommand(originalPrompt);
  if (invocation) {
    const skill = hookState.skills.find((s) => s.name === invocation.skillName);
    if (skill) {
      let prompt = invocation.args
        ? `${skill.instructions}\n\n${invocation.args}`
        : skill.instructions;
      if (skill.memoryEnabled) {
        const { augmented } = buildAugmentedPrompt(prompt, hookState.memories);
        prompt = augmented;
      }
      body.prompt = prompt;
      return JSON.stringify(body);
    }
  }

  const { augmented, usedMemoryIds } = buildAugmentedPrompt(originalPrompt, hookState.memories);
  body.prompt = augmented;

  if (usedMemoryIds.length > 0) {
    hookState.onMemoriesUsed(usedMemoryIds);
  }

  return JSON.stringify(body);
}

function processResponseText(fullText: string) {
  const toolCalls = extractToolCalls(fullText);
  for (const call of toolCalls) {
    hookState.onToolCall(call);
  }
  hookState.onResponseComplete(fullText);
}

async function interceptFetchResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let processed = false;

  const stream = new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!processed) {
            processed = true;
            processResponseText(fullText);
          }
          controller.close();
          break;
        }

        controller.enqueue(value);

        const chunk = decoder.decode(value, { stream: true });
        const events = parseSSEChunk(chunk);
        for (const event of events) {
          const parsed = parseSSEData(event.data);
          if (!parsed) continue;
          const text = extractTextFromParsed(parsed);
          if (text) fullText += text;

          if (!processed && isStreamFinishedFromParsed(parsed)) {
            processed = true;
            processResponseText(fullText);
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

function setupXHRResponseInterceptor(xhr: XMLHttpRequest) {
  let fullText = '';
  let lastLen = 0;
  let processed = false;

  xhr.addEventListener('readystatechange', function () {
    if (xhr.readyState === 3 || xhr.readyState === 4) {
      const raw = xhr.responseText;
      const newData = raw.slice(lastLen);
      lastLen = raw.length;
      if (newData) {
        const events = parseSSEChunk(newData);
        for (const event of events) {
          const parsed = parseSSEData(event.data);
          if (!parsed) continue;
          const text = extractTextFromParsed(parsed);
          if (text) fullText += text;
        }
      }
    }
    if (xhr.readyState === 4 && !processed) {
      processed = true;
      processResponseText(fullText);
    }
  });
}
