import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  normalizeOfficialApiChatConfig,
  type OfficialApiChatConfig,
  type OfficialDeepSeekModel,
  type OfficialDeepSeekReasoningEffort,
  type OfficialDeepSeekThinkingMode,
} from '../../../core/chat/official-api-config';
import {
  DEFAULT_VOICE_SETTINGS,
  detectVoiceCapabilities,
  normalizeVoiceSettings,
  type VoiceSettings,
} from '../../../core/voice/settings';
import { DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES } from '../../../core/deepseek/upload-limits';
import type { ChatMessage as ChatMessageType, ModelType } from '../../../core/types';
import ChatMessage from '../components/ChatMessage';
import { StatusMessage, useConfirm } from '../components/settings/feedback-primitives';
import { createRequestGenerationFence } from '../async-state';
import {
  chatController,
  getChatProviderCapabilities,
  normalizeChatAuthStatus,
  normalizeChatWebModelType,
  type ChatAuthStatus,
  type ChatProvider,
} from '../controllers/chat-controller';
import { consumePendingText, onPendingText } from '../pending-text';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage } from '../runtime-response';

interface ChatStreamMessage extends Partial<ChatAuthStatus> {
  type: string;
  text?: string;
  reasoningText?: string;
  voiceSettings?: VoiceSettings;
  phase?: 'reasoning' | 'answer';
  done?: boolean;
  error?: string;
}

type VisionImageUploadStatus = 'uploading' | 'ready' | 'error';

interface VisionImageAttachment {
  id: string;
  fileId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  status: VisionImageUploadStatus;
  error: string | null;
}

const MAX_VISION_IMAGE_ATTACHMENTS = 4;

const MODEL_OPTIONS: Array<{ value: OfficialDeepSeekModel; labelKey: 'sidepanel.chatPage.modelFlash' | 'sidepanel.chatPage.modelPro' }> = [
  { value: 'deepseek-v4-flash', labelKey: 'sidepanel.chatPage.modelFlash' },
  { value: 'deepseek-v4-pro', labelKey: 'sidepanel.chatPage.modelPro' },
];

const EFFORT_OPTIONS: Array<{ value: OfficialDeepSeekReasoningEffort; labelKey: 'sidepanel.chatPage.effortHigh' | 'sidepanel.chatPage.effortMax' }> = [
  { value: 'high', labelKey: 'sidepanel.chatPage.effortHigh' },
  { value: 'max', labelKey: 'sidepanel.chatPage.effortMax' },
];

const WEB_MODEL_OPTIONS: Array<{
  value: ModelType;
  labelKey: 'sidepanel.settings.modelDefault' | 'sidepanel.settings.modelExpert' | 'sidepanel.settings.modelVision';
}> = [
  { value: null, labelKey: 'sidepanel.settings.modelDefault' },
  { value: 'expert', labelKey: 'sidepanel.settings.modelExpert' },
  { value: 'vision', labelKey: 'sidepanel.settings.modelVision' },
];

export default function ChatPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatConfig, setChatConfig] = useState<OfficialApiChatConfig>(DEFAULT_OFFICIAL_API_CHAT_CONFIG);
  const [webModelType, setWebModelType] = useState<ModelType>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [isListening, setIsListening] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<VisionImageAttachment[]>([]);
  const [msgSeq, setMsgSeq] = useState(0);
  const { confirm, node: confirmNode } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessageType[]>([]);
  const imageAttachmentsRef = useRef<VisionImageAttachment[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSettingsRef = useRef<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const requestFence = useRef(createRequestGenerationFence());
  const voiceCapabilities = detectVoiceCapabilities(window);

  const {
    apiControlsEnabled,
    webControlsEnabled,
    visionAttachmentsEnabled,
  } = getChatProviderCapabilities(authStatus, webModelType);
  const hasUploadingImageAttachment = imageAttachments.some((item) => item.status === 'uploading');
  const hasFailedImageAttachment = imageAttachments.some((item) => item.status === 'error');
  const readyImageFileIds = visionAttachmentsEnabled
    ? imageAttachments
      .filter((item) => item.status === 'ready' && item.fileId)
      .map((item) => item.fileId as string)
    : [];
  const canSendMessage = !isStreaming && !hasUploadingImageAttachment && !hasFailedImageAttachment && !!inputText.trim();

  function updateLastAssistant(update: (message: ChatMessageType) => ChatMessageType) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const next = [...prev.slice(0, -1), update(last)];
        messagesRef.current = next;
        return next;
      }
      const next = [...prev, update({ role: 'assistant', text: '' })];
      messagesRef.current = next;
      return next;
    });
  }

  function appendAssistantText(text: string) {
    updateLastAssistant((message) => ({
      ...message,
      text: message.text + text,
    }));
  }

  function appendAssistantReasoning(reasoningText: string) {
    updateLastAssistant((message) => ({
      ...message,
      reasoningText: `${message.reasoningText ?? ''}${reasoningText}`,
    }));
  }

  useEffect(() => {
    const text = consumePendingText();
    if (text) {
      setInputText(text);
      inputRef.current?.focus();
    }
    return onPendingText((pendingText) => {
      setInputText(pendingText);
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    imageAttachmentsRef.current = imageAttachments;
  }, [imageAttachments]);

  useEffect(() => () => {
    imageAttachmentsRef.current.forEach(revokeVisionAttachmentPreview);
  }, []);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  useEffect(() => {
    const generation = requestFence.current.begin();
    void chatController.load()
      .then((snapshot) => {
        if (!requestFence.current.isCurrent(generation)) return;
        setAuthStatus(snapshot.authStatus);
        setChatConfig(snapshot.chatConfig);
        setWebModelType(snapshot.webModelType);
        setVoiceSettings(snapshot.voiceSettings);
        if (snapshot.loadErrors.length > 0) {
          setError(snapshot.loadErrors.map(getRuntimeErrorMessage).join('; '));
        }
      })
      .catch((loadError) => {
        if (requestFence.current.isCurrent(generation)) {
          setError(getRuntimeErrorMessage(loadError));
        }
      });
    return () => requestFence.current.invalidate();
  }, []);

  useEffect(() => {
    const handler = (msg: ChatStreamMessage) => {
      if (msg.type === 'CHAT_SET_INPUT_TEXT' && typeof msg.text === 'string') {
        setInputText(msg.text);
        inputRef.current?.focus();
        return;
      }

      if (msg.type === 'AUTH_STATUS_CHANGED') {
        const nextAuthStatus = normalizeChatAuthStatus(msg);
        setAuthStatus(nextAuthStatus);
        if (nextAuthStatus.provider !== 'deepseek-web') clearImageAttachments();
        return;
      }

      if (msg.type === 'STATE_UPDATED') {
        const nextModelType = (msg as { modelType?: unknown }).modelType;
        if (nextModelType !== undefined) {
          const normalizedModelType = normalizeChatWebModelType(nextModelType);
          setWebModelType(normalizedModelType);
          if (normalizedModelType !== 'vision') clearImageAttachments();
        }
        return;
      }

      if (msg.type === 'VOICE_SETTINGS_UPDATED') {
        setVoiceSettings(normalizeVoiceSettings(msg.voiceSettings));
        return;
      }

      if (msg.type !== 'CHAT_STREAM_CHUNK') return;

      if (msg.error) {
        setError(msg.error);
        setIsStreaming(false);
        return;
      }

      if (msg.done) {
        setIsStreaming(false);
        clearImageAttachments();
        const currentVoiceSettings = voiceSettingsRef.current;
        if (currentVoiceSettings.readAloudEnabled && voiceCapabilities.speechSynthesis) {
          setTimeout(() => speakLatestAssistant(messagesRef.current, currentVoiceSettings), 0);
        }
        return;
      }

      if (msg.reasoningText) {
        appendAssistantReasoning(msg.reasoningText);
      }

      if (msg.text) {
        appendAssistantText(msg.text);
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const saveChatConfig = async (patch: Partial<OfficialApiChatConfig>) => {
    const next = normalizeOfficialApiChatConfig({ ...chatConfig, ...patch });
    setChatConfig(next);
    try {
      setChatConfig(await chatController.saveConfig(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || !canSendMessage) return;
    const refFileIds = readyImageFileIds;

    setMessages((prev) => {
      const next = [...prev, { role: 'user' as const, text }];
      messagesRef.current = next;
      return next;
    });
    setMsgSeq((n) => n + 1);
    setInputText('');
    setIsStreaming(true);
    setError(null);

    void chatController.submitPrompt({
      text,
      authStatus,
      config: chatConfig,
      refFileIds,
    }).catch((submitError) => {
      setError(getRuntimeErrorMessage(submitError) || t('sidepanel.chatPage.sendFailed'));
      setIsStreaming(false);
    });
  };

  const newSession = async () => {
    // Confirm before discarding an in-progress conversation.
    if (messages.length > 0) {
      const ok = await confirm({
        title: t('sidepanel.chatPage.newSessionTitle'),
        message: t('sidepanel.chatPage.newSessionConfirm'),
        confirmLabel: t('sidepanel.chatPage.newSession'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    try {
      await chatController.newSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    messagesRef.current = [];
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    clearImageAttachments();
    stopVoiceInput();
    inputRef.current?.focus();
  };

  const retryLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setInputText(lastUser.text);
    inputRef.current?.focus();
  };

  const handleModelChange = (model: OfficialDeepSeekModel) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig({ model });
  };

  const handleThinkingChange = (thinking: OfficialDeepSeekThinkingMode) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig({ thinking });
  };

  const handleEffortChange = (reasoningEffort: OfficialDeepSeekReasoningEffort) => {
    if (!apiControlsEnabled || isStreaming || chatConfig.thinking !== 'enabled') return;
    void saveChatConfig({ reasoningEffort });
  };

  const handleWebModelChange = async (nextModelType: ModelType) => {
    if (!webControlsEnabled || isStreaming) return;
    const previous = webModelType;
    setWebModelType(nextModelType);
    try {
      await chatController.setWebModelType(nextModelType);
      if (nextModelType !== 'vision') clearImageAttachments();
    } catch (err) {
      setWebModelType(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const chooseImageFile = () => {
    if (!visionAttachmentsEnabled || isStreaming) return;
    fileInputRef.current?.click();
  };

  const handleImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void uploadImageFiles(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!visionAttachmentsEnabled || isStreaming) return;
    const files = collectClipboardImageFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadImageFiles(files);
  };

  const uploadImageFiles = async (files: File[]) => {
    if (!visionAttachmentsEnabled || files.length === 0) return;
    const availableSlots = MAX_VISION_IMAGE_ATTACHMENTS - imageAttachmentsRef.current.length;
    if (availableSlots <= 0) {
      setError(t('sidepanel.chatPage.imageUploadMax', { count: MAX_VISION_IMAGE_ATTACHMENTS }));
      return;
    }

    const selectedFiles = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      setError(t('sidepanel.chatPage.imageUploadMax', { count: MAX_VISION_IMAGE_ATTACHMENTS }));
    } else {
      setError(null);
    }

    for (const file of selectedFiles) {
      await uploadImageFile(file);
    }
  };

  const uploadImageFile = async (file: File) => {
    const validationError = validateImageFile(file, t);
    if (validationError) {
      setError(validationError);
      return;
    }

    const attachmentId = createVisionAttachmentId();
    const previewUrl = URL.createObjectURL(file);
    const baseAttachment: VisionImageAttachment = {
      id: attachmentId,
      fileId: null,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl,
      status: 'uploading',
      error: null,
    };

    setImageAttachments((prev) => [...prev, baseAttachment]);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const uploaded = await chatController.uploadImage({
        dataUrl,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      const fileId = uploaded.id;

      setImageAttachments((prev) => prev.map((item) => (
        item.id === attachmentId
          ? {
            ...item,
            fileId,
            status: 'ready',
            error: null,
          }
          : item
      )));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImageAttachments((prev) => prev.map((item) => (
        item.id === attachmentId
          ? { ...item, status: 'error', error: message }
          : item
      )));
      if (imageAttachmentsRef.current.some((item) => item.id === attachmentId)) {
        setError(message);
      }
    }
  };

  const removeImageAttachment = (attachmentId: string) => {
    setImageAttachments((prev) => {
      const removed = prev.find((item) => item.id === attachmentId);
      if (removed) revokeVisionAttachmentPreview(removed);
      return prev.filter((item) => item.id !== attachmentId);
    });
  };

  const clearImageAttachments = () => {
    setImageAttachments((prev) => {
      prev.forEach(revokeVisionAttachmentPreview);
      return [];
    });
  };

  const startVoiceInput = () => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition || isListening) return;

    const recognition = new Recognition();
    recognition.lang = navigator.language || 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results as ArrayLike<SpeechRecognitionResultLike>)
        .map((result) => result[0]?.transcript ?? '')
        .join('')
        .trim();
      if (transcript) setInputText(transcript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const stopVoiceInput = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (authStatus?.available === false) {
    return (
      <div className="ds-chat-auth-empty">
        <p className="text-sm mb-3" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.chatPage.authRequired')}
        </p>
        <p className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.chatPage.authHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="ds-chat-page">
      <header className="ds-chat-header">
        <div className="ds-chat-header-top">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
                {t('sidepanel.chatPage.title')}
              </span>
              <ProviderBadge provider={authStatus?.provider ?? null} />
            </div>
            <p className="ds-chat-subtitle">
              {apiControlsEnabled
                ? t('sidepanel.chatPage.apiDescription')
                : t('sidepanel.chatPage.webDescription')}
            </p>
          </div>

          <div className="ds-chat-header-actions">
            {voiceSettings.readAloudEnabled && voiceCapabilities.speechSynthesis && (
              <button
                type="button"
                onClick={() => speakLatestAssistant(messagesRef.current, voiceSettings)}
                className="ds-chat-text-button"
                title={t('sidepanel.chatPage.readLatest')}
              >
                {t('sidepanel.chatPage.read')}
              </button>
            )}
            <button
              type="button"
              onClick={newSession}
              className="ds-chat-icon-button"
              title={t('sidepanel.chatPage.newSessionTitle')}
              aria-label={t('sidepanel.chatPage.newSessionTitle')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        {apiControlsEnabled && (
          <div className="ds-chat-config-panel">
            <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.modelLabel')}>
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleModelChange(option.value)}
                  className={`ds-chat-segment${chatConfig.model === option.value ? ' ds-chat-segment-active' : ''}`}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>

            <div className="ds-chat-control-row">
              <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.thinkingLabel')}>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleThinkingChange('disabled')}
                  className={`ds-chat-segment${chatConfig.thinking === 'disabled' ? ' ds-chat-segment-active' : ''}`}
                >
                  {t('sidepanel.chatPage.thinkingOff')}
                </button>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleThinkingChange('enabled')}
                  className={`ds-chat-segment${chatConfig.thinking === 'enabled' ? ' ds-chat-segment-active' : ''}`}
                >
                  {t('sidepanel.chatPage.thinkingOn')}
                </button>
              </div>

              <select
                value={chatConfig.reasoningEffort}
                disabled={isStreaming || chatConfig.thinking !== 'enabled'}
                onChange={(e) => handleEffortChange(e.target.value as OfficialDeepSeekReasoningEffort)}
                className="ds-chat-effort-select"
                title={t('sidepanel.chatPage.effortLabel')}
                aria-label={t('sidepanel.chatPage.effortLabel')}
              >
                {EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {webControlsEnabled && (
          <div className="ds-chat-config-panel">
            <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.modelLabel')}>
              {WEB_MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value ?? 'default'}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => void handleWebModelChange(option.value)}
                  className={`ds-chat-segment${webModelType === option.value ? ' ds-chat-segment-active' : ''}`}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div ref={listRef} className="ds-chat-messages">
        {confirmNode}

        {messages.length === 0 && !isStreaming && (
          <div className="ds-chat-empty">
            <div className="ds-empty-state-icon">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="ds-empty-state-title">{t('sidepanel.chatPage.empty')}</div>
            <div className="ds-empty-state-description">{t('sidepanel.chatPage.emptyHelp')}</div>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage
            key={`${msg.role}-${index}-${msgSeq}`}
            message={msg}
            isStreaming={isStreaming && index === messages.length - 1 && msg.role === 'assistant'}
          />
        ))}

        {error && (
          <div className="ds-chat-error-wrap">
            <StatusMessage tone="error">
              {error}
              <button
                type="button"
                onClick={retryLast}
                className="ml-2 underline opacity-80 hover:opacity-100"
              >
                {t('common.retry')}
              </button>
            </StatusMessage>
          </div>
        )}
      </div>

      <footer className="ds-chat-composer-wrap">
        <div className="ds-chat-composer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="ds-chat-file-input"
            onChange={handleImageFileChange}
          />
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t('sidepanel.chatPage.inputPlaceholder')}
            rows={1}
            className="ds-chat-input"
          />
          {imageAttachments.length > 0 && (
            <div className="ds-chat-attachments" aria-label={t('sidepanel.chatPage.imageAttachments')}>
              {imageAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className={`ds-chat-attachment ds-chat-attachment-${attachment.status}`}
                >
                  <img src={attachment.previewUrl} alt="" className="ds-chat-attachment-thumb" />
                  <div className="ds-chat-attachment-body">
                    <div className="ds-chat-attachment-name" title={attachment.name}>
                      {attachment.name}
                    </div>
                    <div className="ds-chat-attachment-status">
                      {attachment.error ?? getImageAttachmentStatusLabel(attachment.status, t)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ds-chat-attachment-remove"
                    onClick={() => removeImageAttachment(attachment.id)}
                    title={t('sidepanel.chatPage.removeImageAttachment', { name: attachment.name })}
                    aria-label={t('sidepanel.chatPage.removeImageAttachment', { name: attachment.name })}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="ds-chat-composer-actions">
            <span className="ds-chat-current-config">
              {apiControlsEnabled
                ? getConfigLabel(chatConfig, t)
                : webControlsEnabled
                  ? getWebModelLabel(webModelType, t)
                  : t('sidepanel.chatPage.webProvider')}
            </span>
            <div className="ds-chat-composer-buttons">
              {visionAttachmentsEnabled && (
                <button
                  type="button"
                  onClick={chooseImageFile}
                  disabled={isStreaming || imageAttachments.length >= MAX_VISION_IMAGE_ATTACHMENTS}
                  className="ds-chat-attachment-button"
                  title={t('sidepanel.chatPage.uploadImage')}
                  aria-label={t('sidepanel.chatPage.uploadImage')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7a3 3 0 013-3h10a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 14l2.3-2.3a1 1 0 011.4 0L15 15m-1-1 1.3-1.3a1 1 0 011.4 0L20 16M9 8.5h.01" />
                  </svg>
                </button>
              )}
              {voiceSettings.inputEnabled && voiceCapabilities.speechRecognition && (
                <button
                  type="button"
                  onClick={isListening ? stopVoiceInput : startVoiceInput}
                  className={`ds-chat-mic-button${isListening ? ' ds-chat-mic-button-active' : ''}`}
                  title={isListening ? t('sidepanel.chatPage.stopListening') : t('sidepanel.chatPage.voiceInput')}
                  aria-label={isListening ? t('sidepanel.chatPage.stopListening') : t('sidepanel.chatPage.voiceInput')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4a3 3 0 00-3 3v5a3 3 0 006 0V7a3 3 0 00-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 11a7 7 0 0014 0M12 18v3m-4 0h8" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={sendMessage}
                disabled={!canSendMessage}
                className="ds-chat-send-button"
                title={t('sidepanel.chatPage.send')}
                aria-label={t('sidepanel.chatPage.send')}
              >
                {isStreaming ? (
                  <span className="ds-chat-send-dots" aria-hidden="true">...</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: ChatProvider }) {
  const { t } = useI18n();
  if (!provider) return null;
  const label = provider === 'official-api'
    ? t('sidepanel.chatPage.apiProvider')
    : t('sidepanel.chatPage.webProvider');
  return <span className="ds-chat-provider-badge">{label}</span>;
}

function getWebModelLabel(
  modelType: ModelType,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (modelType === 'expert') return t('sidepanel.settings.modelExpert');
  if (modelType === 'vision') return t('sidepanel.settings.modelVision');
  return t('sidepanel.settings.modelDefault');
}

function getConfigLabel(
  config: OfficialApiChatConfig,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const model = config.model === 'deepseek-v4-pro'
    ? t('sidepanel.chatPage.modelPro')
    : t('sidepanel.chatPage.modelFlash');
  if (config.thinking !== 'enabled') {
    return `${model} · ${t('sidepanel.chatPage.thinkingOff')}`;
  }
  const effort = config.reasoningEffort === 'max'
    ? t('sidepanel.chatPage.effortMax')
    : t('sidepanel.chatPage.effortHigh');
  return `${model} · ${t('sidepanel.chatPage.thinkingOn')} · ${effort}`;
}

function getImageAttachmentStatusLabel(
  status: VisionImageUploadStatus,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (status === 'uploading') return t('sidepanel.chatPage.imageUploading');
  if (status === 'ready') return t('sidepanel.chatPage.imageReady');
  return t('sidepanel.chatPage.imageUploadFailed');
}

function validateImageFile(
  file: File,
  t: ReturnType<typeof useI18n>['t'],
): string | null {
  if (!file.type.startsWith('image/')) {
    return t('sidepanel.chatPage.imageOnly');
  }
  if (file.size <= 0) {
    return t('sidepanel.chatPage.imageEmpty');
  }
  if (file.size > DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES) {
    return t('sidepanel.chatPage.imageTooLarge', {
      limit: formatImageUploadBytes(DEEPSEEK_IMAGE_UPLOAD_MAX_BYTES),
    });
  }
  return null;
}

function collectClipboardImageFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('FileReader did not return a data URL.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function revokeVisionAttachmentPreview(attachment: VisionImageAttachment) {
  URL.revokeObjectURL(attachment.previewUrl);
}

function createVisionAttachmentId(): string {
  return crypto.randomUUID?.() ?? `vision-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatImageUploadBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

type SpeechRecognitionResultLike = {
  readonly 0: { transcript?: string };
};

type SpeechRecognitionEventLike = {
  results: Iterable<SpeechRecognitionResultLike> | ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const value = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return value.SpeechRecognition ?? value.webkitSpeechRecognition ?? null;
}

function speakLatestAssistant(messages: ChatMessageType[], settings: VoiceSettings) {
  if (!('speechSynthesis' in window)) return;
  const text = [...messages].reverse().find((message) => message.role === 'assistant')?.text.trim();
  if (!text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = settings.rate;
  utterance.pitch = settings.pitch;
  window.speechSynthesis.speak(utterance);
}
