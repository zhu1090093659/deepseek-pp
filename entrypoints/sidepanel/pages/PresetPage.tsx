import { useEffect, useRef, useState } from 'react';
import type { SystemPromptPreset } from '../../../core/types';
import { decodeActivePreset, decodePresetCollection } from '../../../core/preset/codec';
import PageIntro from '../components/PageIntro';
import PresetCard from '../components/PresetCard';
import PresetForm from '../components/PresetForm';
import { SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { createRequestGenerationFence } from '../async-state';
import {
  decodeRuntimeResponse,
  getRuntimeErrorMessage,
} from '../runtime-response';
import { sidepanelRuntimeClient } from '../runtime-client';

export default function PresetPage() {
  const { t } = useI18n();
  const [presets, setPresets] = useState<SystemPromptPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SystemPromptPreset | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFence = useRef(createRequestGenerationFence());
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const showOperationError = (error: unknown) => {
    banner.show('error', t('sidepanel.presetPage.operationFailed', {
      error: getRuntimeErrorMessage(error),
    }));
  };

  const load = async () => {
    const generation = loadFence.current.begin();
    try {
      const [list, active] = await Promise.all([
        sidepanelRuntimeClient.request(
          { type: 'GET_PRESETS' },
          {
            unavailableMessage: t('sidepanel.presetPage.backendUnavailable'),
            decode: (value) => decodePresetCollection(value, 'presetResponse'),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_ACTIVE_PRESET' },
          {
            acceptFailure: true,
            unavailableMessage: t('sidepanel.presetPage.backendUnavailable'),
            decode: (value) => decodeRuntimeResponse(
              value,
              (candidate) => decodeActivePreset(candidate, 'activePresetResponse'),
              t('sidepanel.presetPage.backendUnavailable'),
            ),
          },
        ),
      ]);
      if (!loadFence.current.isCurrent(generation)) return;
      setPresets(list);
      setActiveId(active?.id ?? null);
      setLoadFailed(false);
    } catch (error) {
      if (!loadFence.current.isCurrent(generation)) return;
      setLoadFailed(true);
      showOperationError(error);
    } finally {
      if (loadFence.current.isCurrent(generation)) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => loadFence.current.invalidate();
  }, []);

  const handleSave = async (preset: SystemPromptPreset) => {
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        { type: 'SAVE_PRESET', payload: preset },
        { unavailableMessage: t('sidepanel.presetPage.backendUnavailable') },
      );
      setShowForm(false);
      setEditing(undefined);
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleImportFiles = async (files: FileList) => {
    try {
      banner.clear();
      const entries = await Promise.all(
        Array.from(files, async (file) => ({
          name: file.name.replace(/\.(txt|md)$/i, '').trim(),
          content: (await file.text()).trim(),
        })),
      );
      for (const { name, content } of entries) {
        if (!content) continue;
        const now = Date.now();
        await sidepanelRuntimeClient.request({
            type: 'SAVE_PRESET',
            payload: {
              id: crypto.randomUUID(),
              name,
              content,
              createdAt: now,
              updatedAt: now,
            } satisfies SystemPromptPreset,
          }, { unavailableMessage: t('sidepanel.presetPage.backendUnavailable') });
      }
      await load();
    } catch (error) {
      await load();
      showOperationError(error);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('sidepanel.presetPage.deleteConfirm'),
      message: t('sidepanel.presetPage.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        { type: 'DELETE_PRESET', payload: { id } },
        { unavailableMessage: t('sidepanel.presetPage.backendUnavailable') },
      );
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        { type: 'SET_ACTIVE_PRESET', payload: { id } },
        { unavailableMessage: t('sidepanel.presetPage.backendUnavailable') },
      );
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleDeactivate = async () => {
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        { type: 'SET_ACTIVE_PRESET', payload: { id: null } },
        { unavailableMessage: t('sidepanel.presetPage.backendUnavailable') },
      );
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleEdit = (preset: SystemPromptPreset) => {
    setEditing(preset);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditing(undefined);
  };

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.presetPage.title')}
        description={t('sidepanel.presetPage.description')}
        meta={activeId ? t('sidepanel.presetPage.activeMeta') : t('sidepanel.presetPage.inactiveMeta')}
        actions={(
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              multiple
              className="hidden"
              onChange={(e) => e.target.files?.length && handleImportFiles(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="ds-btn-cancel px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              {t('sidepanel.presetPage.import')}
            </button>
            <button
              onClick={() => { setEditing(undefined); setShowForm(!showForm); }}
              className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('sidepanel.presetPage.create')}
            </button>
          </>
        )}
      />

      {showForm && (
        <div className="animate-slide-down">
          <PresetForm initial={editing} onSave={handleSave} onCancel={handleCancel} />
        </div>
      )}

      {confirmNode}
      {banner.node}

      {loading ? (
        <SkeletonList rows={3} />
      ) : presets.length === 0 && loadFailed ? null : presets.length === 0 ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="ds-empty-state-title">{t('sidepanel.presetPage.empty')}</div>
          <div className="ds-empty-state-description">{t('sidepanel.presetPage.emptyHelp')}</div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {presets.map((p, index) => (
              <PresetCard
                key={`${p.id}:${index}`}
                preset={p}
                isActive={p.id === activeId}
                onActivate={() => handleActivate(p.id)}
                onDeactivate={handleDeactivate}
                onEdit={() => handleEdit(p)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>

          <div className="ds-info-panel rounded-xl p-3.5">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.presetPage.activeHelp')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
