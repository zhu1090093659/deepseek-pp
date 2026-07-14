import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import type { SavedItem, SavedItemInput } from '../../../core/saved-items/types';
import { createRequestGenerationFence } from '../async-state';
import { getRuntimeErrorMessage } from '../runtime-response';
import { decodeSavedItemList, libraryController } from './library-controller';

type Translator = (key: LocaleMessageKey, params?: MessageParams) => string;
type Confirm = (options: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}) => Promise<boolean>;
type Feedback = {
  clear(): void;
  success(message: string): void;
  error(message: string): void;
};

export function useSavedPageController(t: Translator, confirm: Confirm, feedback: Feedback) {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestFence = useRef(createRequestGenerationFence());
  const translatorRef = useRef(t);
  const feedbackRef = useRef(feedback);
  translatorRef.current = t;
  feedbackRef.current = feedback;

  const operationError = useCallback((error: unknown) => {
    feedbackRef.current.error(translatorRef.current('sidepanel.savedPage.operationFailed', {
      error: getRuntimeErrorMessage(error),
    }));
  }, []);

  const load = useCallback(async () => {
    const generation = requestFence.current.begin();
    try {
      const next = await libraryController.getSavedItems();
      if (!requestFence.current.isCurrent(generation)) return;
      setItems(next);
      setLoadFailed(false);
    } catch (error) {
      if (!requestFence.current.isCurrent(generation)) return;
      setLoadFailed(true);
      operationError(error);
    } finally {
      if (requestFence.current.isCurrent(generation)) setLoading(false);
    }
  }, [operationError]);

  useEffect(() => {
    void load();
    const applySavedItemsUpdate = (message: { type?: string; savedItems?: unknown }) => {
      if (message.type !== 'SAVED_ITEMS_UPDATED') return;
      requestFence.current.invalidate();
      setLoading(false);
      try {
        setItems(decodeSavedItemList(message.savedItems, 'savedItemsUpdate'));
        setLoadFailed(false);
      } catch (error) {
        setLoadFailed(true);
        operationError(error);
      }
    };
    chrome.runtime.onMessage.addListener(applySavedItemsUpdate);
    return () => {
      requestFence.current.invalidate();
      chrome.runtime.onMessage.removeListener(applySavedItemsUpdate);
    };
  }, [load, operationError]);

  const save = useCallback(async (payload: SavedItemInput): Promise<boolean> => {
    try {
      feedback.clear();
      await libraryController.saveSavedItem(payload);
      feedback.success(t('sidepanel.savedPage.saved'));
      await load();
      return true;
    } catch (error) {
      operationError(error);
      return false;
    }
  }, [feedback, load, operationError, t]);

  const remove = useCallback(async (id: string) => {
    const approved = await confirm({
      title: t('sidepanel.savedPage.deleteConfirm'),
      message: t('sidepanel.savedPage.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!approved) return;
    try {
      feedback.clear();
      await libraryController.deleteSavedItem(id);
      await load();
    } catch (error) {
      operationError(error);
    }
  }, [confirm, feedback, load, operationError, t]);

  const insertPrompt = useCallback(async (text: string) => {
    try {
      feedback.clear();
      await libraryController.insertSavedPrompt(text);
      feedback.success(t('sidepanel.savedPage.inserted'));
    } catch (error) {
      feedback.error(t('sidepanel.savedPage.insertFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  }, [feedback, t]);

  return { items, loading, loadFailed, save, remove, insertPrompt };
}
