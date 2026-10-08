'use client';
import { useI18n } from '../lib/i18n/locale-provider';
import type { WorkflowSettings } from '@/lib/workflow-settings';

/** Free numeric inputs shared by workspace, client and document editors. */
export default function WorkflowFields({ value, onChange, disabled = false }: { value: WorkflowSettings; onChange: (value: WorkflowSettings) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <div className="form-fields">
    <div className="form-pair">
      <label className="form-field"><span>{t('Délai de validation (heures)')}</span><input type="number" required min={1 / 60} max={8760} step="any" inputMode="decimal" disabled={disabled} value={Number.isFinite(value.validationHours) ? value.validationHours : ''} onChange={e => onChange({ ...value, validationHours: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
      <label className="form-field"><span>{t('Tours de modifications inclus')}</span><input type="number" required min={0} max={10000} step={1} inputMode="numeric" disabled={disabled} value={Number.isFinite(value.maxRevisionRounds) ? value.maxRevisionRounds : ''} onChange={e => onChange({ ...value, maxRevisionRounds: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
    </div>
    <p className="small-note">{t('Saisissez vos propres valeurs. 0,5 heure = 30 minutes ; 24 heures = 1 jour. Au-delà des tours inclus, une demande supplémentaire est créée avant tout travail payant.')}</p>
  </div>;
}
