import { useEffect, useState } from 'react';
import type { Skill } from '../../../core/types';
import { useI18n } from '../i18n';

interface Props {
  initialSkill?: Skill | null;
  onSave: (skill: Skill) => void;
  onCancel: () => void;
}

export default function SkillForm({ initialSkill, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initialSkill?.name ?? '');
  const [description, setDescription] = useState(initialSkill?.description ?? '');
  const [instructions, setInstructions] = useState(initialSkill?.instructions ?? '');
  const [memoryEnabled, setMemoryEnabled] = useState(initialSkill?.memoryEnabled ?? false);
  const [submitted, setSubmitted] = useState(false);

  const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9一-鿿-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const nameError = submitted && name.trim() && !normalizedName;
  const isEditing = Boolean(initialSkill);

  useEffect(() => {
    setName(initialSkill?.name ?? '');
    setDescription(initialSkill?.description ?? '');
    setInstructions(initialSkill?.instructions ?? '');
    setMemoryEnabled(initialSkill?.memoryEnabled ?? false);
  }, [initialSkill]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!normalizedName || !instructions.trim()) return;
    onSave({
      name: normalizedName,
      description: description.trim(),
      instructions: instructions.trim(),
      source: 'custom',
      memoryEnabled,
      enabled: initialSkill?.enabled !== false,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-form rounded-xl p-4 space-y-3">
      <div>
        <input
          type="text"
          placeholder={t('sidepanel.skill.form.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
          style={nameError ? { borderColor: '#ef4444' } : undefined}
        />
        {nameError && (
          <p className="text-[11px] mt-1" style={{ color: '#ef4444' }}>
            {t('sidepanel.skill.form.nameError')}
          </p>
        )}
        {!nameError && normalizedName && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.skill.form.triggerCommand')} <code className="font-mono" style={{ color: 'var(--ds-blue)' }}>/{normalizedName}</code>
          </p>
        )}
      </div>

      <input
        type="text"
        placeholder={t('sidepanel.skill.form.descriptionPlaceholder')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
      />

      <div>
        <label className="text-[11px] mb-1.5 block font-medium" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.skill.form.instructionsLabel')}
        </label>
        <textarea
          rows={6}
          placeholder={t('sidepanel.skill.form.instructionsPlaceholder')}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="ds-input w-full px-3 py-2 text-sm font-mono rounded-lg resize-none transition-all duration-150"
        />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--ds-text-secondary)' }}>
        <input
          type="checkbox"
          checked={memoryEnabled}
          onChange={(e) => setMemoryEnabled(e.target.checked)}
          className="w-4 h-4 rounded"
          style={{ accentColor: 'var(--ds-blue)' }}
        />
        {t('sidepanel.skill.form.memoryInjectionLabel')}
      </label>

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="ds-btn-cancel px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-150"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="ds-btn-primary px-4 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150"
        >
          {isEditing ? t('common.saveChanges') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
