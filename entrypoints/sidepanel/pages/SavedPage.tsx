import { useMemo, useState } from 'react';
import type { SavedItemInput, SavedItemKind } from '../../../core/saved-items/types';
import { createSavedItemsJsonArtifact, createSavedItemsMarkdownArtifact, type SecondaryExportArtifact } from '../../../core/export/secondary-artifacts';
import PageIntro from '../components/PageIntro';
import { SegmentedControl, SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { SVG_PATHS } from '../constants';
import { useSavedPageController } from '../controllers/useSavedPageController';
import { useI18n } from '../i18n';

export default function SavedPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SavedItemKind>('snippet');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();
  const {
    items,
    loading,
    loadFailed,
    save: saveItem,
    remove,
    insertPrompt,
  } = useSavedPageController(t, confirm, {
    clear: banner.clear,
    success: (message) => banner.show('success', message),
    error: (message) => banner.show('error', message),
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [
      item.title,
      item.content,
      item.sourceUrl ?? '',
      item.tags.join(' '),
    ].join('\n').toLowerCase().includes(needle));
  }, [items, query]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    const payload: SavedItemInput = {
      kind,
      title,
      content,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    if (await saveItem(payload)) {
      setTitle('');
      setContent('');
      setTags('');
    }
  };

  const exportItems = (format: 'markdown' | 'json') => {
    const artifact = format === 'json'
      ? createSavedItemsJsonArtifact(items)
      : createSavedItemsMarkdownArtifact(items);
    downloadSecondaryArtifact(artifact);
  };

  const inputClass = 'w-full px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]';
  const inputStyle = {
    background: 'var(--ds-bg)',
    borderColor: 'var(--ds-border)',
    color: 'var(--ds-text)',
  };

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.savedPage.title')}
        description={t('sidepanel.savedPage.description')}
        meta={t('sidepanel.savedPage.count', { count: items.length })}
        actions={(
          <>
            <button
              type="button"
              onClick={() => exportItems('markdown')}
              disabled={items.length === 0}
              className="ds-btn-secondary px-2.5 py-1.5 text-[11px] font-medium rounded-lg disabled:opacity-40"
            >
              {t('sidepanel.savedPage.exportMarkdown')}
            </button>
            <button
              type="button"
              onClick={() => exportItems('json')}
              disabled={items.length === 0}
              className="ds-btn-secondary px-2.5 py-1.5 text-[11px] font-medium rounded-lg disabled:opacity-40"
            >
              {t('sidepanel.savedPage.exportJson')}
            </button>
          </>
        )}
      />

      <div className="ds-surface-panel rounded-xl p-4 space-y-3">
        <SegmentedControl
          options={[
            { key: 'snippet', label: t('sidepanel.savedPage.snippet') },
            { key: 'bookmark', label: t('sidepanel.savedPage.bookmark') },
          ]}
          value={kind}
          onChange={(key) => setKind(key)}
          ariaLabel={t('sidepanel.savedPage.title')}
          size="sm"
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('sidepanel.savedPage.titlePlaceholder')}
          className={inputClass}
          style={inputStyle}
        />
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t('sidepanel.savedPage.contentPlaceholder')}
          rows={4}
          className={`${inputClass} resize-none`}
          style={inputStyle}
        />
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t('sidepanel.savedPage.tagsPlaceholder')}
          className={inputClass}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={save}
          disabled={!title.trim() || !content.trim()}
          className="ds-btn-primary w-full py-2.5 text-xs font-medium text-white rounded-lg transition-all duration-150 disabled:opacity-40"
        >
          {t('sidepanel.savedPage.save')}
        </button>
        {banner.node}
      </div>

      {confirmNode}

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('sidepanel.savedPage.searchPlaceholder')}
        className={inputClass}
        style={inputStyle}
      />

      <div className="space-y-2">
        {loading ? (
          <SkeletonList rows={3} />
        ) : !loadFailed && filtered.length === 0 && (
          <div className="ds-empty-state">
            <div className="ds-empty-state-icon">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
              </svg>
            </div>
            <div className="ds-empty-state-title">{t('sidepanel.savedPage.empty')}</div>
            <div className="ds-empty-state-description">{t('sidepanel.savedPage.emptyHelp')}</div>
          </div>
        )}
        {filtered.map((item) => (
          <article key={item.id} className="ds-surface-panel rounded-xl p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
                  {item.title}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {item.kind === 'snippet' ? t('sidepanel.savedPage.snippet') : t('sidepanel.savedPage.bookmark')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="shrink-0 p-1.5 rounded-md transition-colors"
                style={{ color: 'var(--ds-danger)' }}
                title={t('common.delete')}
                aria-label={t('common.delete')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.trash} />
                </svg>
              </button>
            </div>
            <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ds-text-secondary)' }}>
              {item.content.length > 280 ? `${item.content.slice(0, 280)}...` : item.content}
            </p>
            {item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => insertPrompt(item.content)}
              className="ds-btn-secondary w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150"
            >
              {t('sidepanel.savedPage.insertPrompt')}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function downloadSecondaryArtifact(artifact: SecondaryExportArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
