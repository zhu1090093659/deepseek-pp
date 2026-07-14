import { useState } from 'react';
import type { MemoryType } from '../../../core/types';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import { SegmentedControl, SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useMemoryPageController } from '../controllers/useMemoryPageController';
import { useI18n } from '../i18n';

export default function MemoryPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();
  const {
    memories,
    loading,
    loadFailed,
    showForm,
    editingMemory,
    toggleCreateForm,
    edit,
    cancelEdit,
    remove,
    save,
    togglePin,
  } = useMemoryPageController(t, confirm, {
    clear: banner.clear,
    error: (message) => banner.show('error', message),
  });

  const filtered = filter === 'all' ? memories : memories.filter((m) => m.type === filter);
  const filterTypes = [
    { key: 'all' as const, label: t('common.all') },
    ...MEMORY_TYPE_CONFIG.map((typeConfig) => ({
      key: typeConfig.key,
      label: t(typeConfig.labelKey),
    })),
  ];

  return (
    <div className="p-4 space-y-3">
      <PageIntro
        title={t('sidepanel.memoryPage.title')}
        description={t('sidepanel.memoryPage.description')}
        meta={t('sidepanel.memoryPage.count', { count: memories.length })}
      />

      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          options={filterTypes}
          value={filter}
          onChange={(key) => setFilter(key)}
          ariaLabel={t('sidepanel.memoryPage.title')}
          size="sm"
        />
        <button
          onClick={toggleCreateForm}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('common.add')}
        </button>
      </div>

      {confirmNode}
      {banner.node}

      {showForm && (
        <div className="animate-slide-down">
          <MemoryForm
            initial={editingMemory}
            onSave={save}
            onCancel={cancelEdit}
          />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : !loadFailed && filtered.length === 0 ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div className="ds-empty-state-title">
            {memories.length === 0 ? t('sidepanel.memoryPage.emptyAll') : t('sidepanel.memoryPage.emptyFiltered')}
          </div>
          {memories.length === 0 && (
            <div className="ds-empty-state-description">
              {t('sidepanel.memoryPage.emptyHelp')}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              onDelete={() => remove(m.id!)}
              onEdit={() => edit(m)}
              onTogglePin={() => togglePin(m)}
            />
          ))}
        </div>
      )}

    </div>
  );
}
