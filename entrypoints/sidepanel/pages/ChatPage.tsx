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
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Consume pending text from right-click on mount + register live callback
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
    const handler = (msg: { type: string; text?: string; done?: boolean; error?: string; hasToken?: boolean }) => {
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
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { role: 'assistant', text: last.text + (msg.text ?? '') }];
          }
          return [...prev, { role: 'assistant', text: msg.text ?? '' }];
        });
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

    chrome.runtime.sendMessage({ type: 'CHAT_SUBMIT_PROMPT', payload: { text } })
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
        <button
          onClick={newSession}
          className="text-xs px-2.5 py-1 rounded-md"
          style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}
          title="新建会话"
        >
          新建
        </button>
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
