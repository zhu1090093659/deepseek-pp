import { useState, useEffect, useRef } from 'react';
import type { ChatMessage as ChatMessageType } from '../../../core/types';
import ChatMessage from '../components/ChatMessage';
import { consumePendingText, onPendingText } from '../pending-text';

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [modelType, setModelType] = useState<'expert' | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted mode settings on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_CHAT_MODES' })
      .then((modes: { thinkingEnabled?: boolean; searchEnabled?: boolean; modelType?: 'expert' | null } | undefined) => {
        if (modes) {
          if (modes.thinkingEnabled !== undefined) setThinkingEnabled(modes.thinkingEnabled);
          if (modes.searchEnabled !== undefined) setSearchEnabled(modes.searchEnabled);
          if (modes.modelType !== undefined) setModelType(modes.modelType);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const text = consumePendingText();
    if (text) {
      setInputText(text);
      inputRef.current?.focus();
    }
    return onPendingText((t) => {
      setInputText(t);
      inputRef.current?.focus();
    });
  }, []);

  // Check auth status on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })
      .then((resp: { hasToken?: boolean } | undefined) => {
        setHasToken(resp?.hasToken ?? false);
      })
      .catch(() => setHasToken(false));
  }, []);

  // Listen for streaming chunks and incoming text
  useEffect(() => {
    const handler = (msg: { type: string; text?: string; done?: boolean; error?: string; hasToken?: boolean; status?: string }) => {
      if (msg.type === 'CHAT_SET_INPUT_TEXT' && typeof msg.text === 'string') {
        setInputText(msg.text);
        inputRef.current?.focus();
        return;
      }
      if (msg.type === 'AUTH_STATUS_CHANGED') {
        setHasToken(msg.hasToken ?? false);
        return;
      }
      if (msg.type === 'CHAT_STREAM_CHUNK') {
        if (msg.error) {
          setError(msg.error);
          setIsStreaming(false);
          return;
        }
        if (msg.done) {
          setIsStreaming(false);
          return;
        }
        if (msg.text) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { role: 'assistant', text: last.text + (msg.text ?? '') }];
            }
            return [...prev, { role: 'assistant', text: msg.text ?? '' }];
          });
        }
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInputText('');
    setIsStreaming(true);
    setError(null);

    chrome.runtime.sendMessage({ type: 'CHAT_SUBMIT_PROMPT', payload: { text, thinkingEnabled, searchEnabled, modelType } })
      .catch((err: Error) => {
        setError(err.message);
        setIsStreaming(false);
      });
  };

  const newSession = () => {
    chrome.runtime.sendMessage({ type: 'CHAT_NEW_SESSION' }).catch(() => {});
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (hasToken === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <p className="text-sm mb-3" style={{ color: 'var(--ds-text-secondary)' }}>
          请先在 chat.deepseek.com 登录并发一条消息
        </p>
        <p className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
          插件需要捕获你的登录凭证才能直接对话
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--ds-border)' }}>
        <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>对话</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const next = !thinkingEnabled;
              setThinkingEnabled(next);
              chrome.runtime.sendMessage({ type: 'SET_CHAT_MODES', payload: { thinkingEnabled: next } }).catch(() => {});
            }}
            className="text-xs px-2 py-0.5 rounded-md"
            style={{
              color: thinkingEnabled ? 'var(--ds-purple)' : 'var(--ds-text-tertiary)',
              background: thinkingEnabled ? 'var(--ds-purple-bg)' : 'var(--ds-surface)',
              border: thinkingEnabled ? '1px solid var(--ds-purple-border)' : '1px solid transparent',
            }}
            title="深度思考"
          >
            思考
          </button>
          <button
            onClick={() => {
              const next = !searchEnabled;
              setSearchEnabled(next);
              chrome.runtime.sendMessage({ type: 'SET_CHAT_MODES', payload: { searchEnabled: next } }).catch(() => {});
            }}
            className="text-xs px-2 py-0.5 rounded-md"
            style={{
              color: searchEnabled ? 'var(--ds-info)' : 'var(--ds-text-tertiary)',
              background: searchEnabled ? 'var(--ds-info-bg)' : 'var(--ds-surface)',
              border: searchEnabled ? '1px solid var(--ds-info-border)' : '1px solid transparent',
            }}
            title="联网搜索"
          >
            搜索
          </button>
          <button
            onClick={() => {
              const next = modelType === 'expert' ? null : 'expert';
              setModelType(next);
              chrome.runtime.sendMessage({ type: 'SET_CHAT_MODES', payload: { modelType: next } }).catch(() => {});
            }}
            className="text-xs px-2 py-0.5 rounded-md"
            style={{
              color: modelType === 'expert' ? 'var(--ds-warning)' : 'var(--ds-text-tertiary)',
              background: modelType === 'expert' ? 'var(--ds-warning-bg)' : 'var(--ds-surface)',
              border: modelType === 'expert' ? '1px solid var(--ds-warning-border)' : '1px solid transparent',
            }}
            title="专家模式"
          >
            专家
          </button>
          <button
            onClick={newSession}
            className="text-xs px-2.5 py-1 rounded-md"
            style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}
            title="新建会话"
          >
            新建
          </button>
          <button
            onClick={async () => {
              const resp = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_SESSION' });
              if (resp?.sessionId) {
                chrome.tabs.create({ url: `https://chat.deepseek.com/a/chat/s/${resp.sessionId}` });
              }
            }}
            className="text-xs px-2.5 py-1 rounded-md"
            style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}
            title="跳转到官网对话"
          >
            跳转
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
            输入消息开始对话
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
          />
        ))}
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
            <span className="inline-block w-3 h-3 rounded-full animate-spin" style={{
              border: '2px solid var(--ds-border)',
              borderTopColor: 'var(--ds-blue)',
            }} />
            <span>思考中...</span>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400 text-center mt-2">{error}</div>
        )}
      </div>

      {/* Input */}
      <div className="p-3" style={{ borderTop: '1px solid var(--ds-border)' }}>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={2}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !inputText.trim()}
            className="self-end px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--ds-accent)', color: '#fff' }}
          >
            {isStreaming ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
