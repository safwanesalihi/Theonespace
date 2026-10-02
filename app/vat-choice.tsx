'use client';

import { useState } from 'react';
import { useI18n } from './locale-provider';

/** One tax choice for studio documents, extra quotes and print documents. */
export default function VatChoice({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(Number(value) > 0);
  const [lastRate, setLastRate] = useState(Number(value) > 0 ? value : '20');

  function choose(withVat: boolean) {
    if (!withVat && Number(value) > 0) setLastRate(value);
    setEnabled(withVat);
    onChange(withVat ? lastRate : '0');
  }

  return <div className="form-fields">
    <label className="form-field"><span>{t('TVA')}</span>
      <select value={enabled ? 'yes' : 'no'} disabled={disabled} onChange={e => choose(e.target.value === 'yes')}>
        <option value="yes">{t('TVA')}</option>
        <option value="no">{t('Sans TVA')}</option>
      </select>
    </label>
    {enabled ? <label className="form-field"><span>{t('TVA (%)')}</span>
      <input type="number" required min={0.01} max={100} step="0.01" disabled={disabled} value={value} onChange={e => onChange(e.target.value)} />
    </label> : <small className="small-note">{t('Aucune TVA ajoutée au total.')}</small>}
  </div>;
}
