"use client";
// The client portal's documents: quotes, invoices and contracts, downloadable, with an explicit
// acceptance or refusal of a sent quote or contract.
import { Surface } from "@/components/ui/surface";
import pipelineStyles from '@/features/documents/client-pipeline.module.css';
import { ScopeSummary } from '@/features/documents/service-scope';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { computeTotals, docLabels, docStatusLabels } from '@/lib/documents';
import { Download, FileSignature, Loader2 } from 'lucide-react';
import type { PortalContext } from "./use-portal";

export function DocumentsScreen({ ctx }: { ctx: PortalContext }) {
  const { client, copy, decideDocument, decidingDocument, documentRead, documentSaving, documents, downloadDocument, fmt, mode, pdfBusy, setDecidingDocument, setDocumentRead, t } = ctx;
  return (
    <div className="pc-page">
      <div className="page-heading">
        <h1>{copy.documents}</h1>
        <p>{client.name}</p>
      </div>

      {documents.length ? (
        <div className="pc-list">
          {documents.map(doc => {
            const { total } = computeTotals(doc.lineItems || [], doc.taxRate);
            const statusColors = { draft: 's1', sent: 's2', paid: 's3', overdue: 's4', cancelled: 's5', accepted: 's3', refused: 's5' };
            const statusClass = statusColors[doc.docStatus || 'draft'];
            return (
              <Surface asChild tone="default" key={doc.id}><div className={`pc-list-card ${pipelineStyles.documentCard}`}>
              <div className={pipelineStyles.documentHead}>
                <div className="pc-list-card-main">
                  <div className="pc-list-icon"><FileSignature size={20} /></div>
                  <div className="pc-list-card-content">
                    <strong>{t(docLabels[doc.docType || 'devis'])} {doc.number}</strong>
                    <small>{fmt(doc.issuedAt)} · {t(docStatusLabels[doc.docStatus || 'draft'])}</small>
                  </div>
                </div>
                <div className="pc-list-meta">
                  <strong style={{fontSize: 16}}>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD</strong>
                  <span className={`status ${statusClass}`}>{t(docStatusLabels[doc.docStatus || 'draft'])}</span>
                  <button type="button" className="btn" aria-label={copy.download} disabled={!!pdfBusy} onClick={() => void downloadDocument(doc)}>
                    {pdfBusy === doc.id ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Télécharger
                  </button>
                </div>
              </div>
              <details className={pipelineStyles.documentInfo}><summary>{t('Consulter les détails et conditions')}</summary>
                <ul>{doc.lineItems?.map((line, i) => <li key={i}>{line.quantity} × {line.description} · {(line.quantity * line.unitPrice).toFixed(2)} MAD HT</li>)}</ul>
                <p>{(doc.taxRate ?? 0) > 0 ? `${t('TVA')} : ${doc.taxRate} %` : t('Sans TVA')}</p>
                {doc.serviceScope && <ScopeSummary scope={doc.serviceScope} workflow={doc.workflowTerms} />}
                {doc.notes && <p className="document-copy">{doc.notes}</p>}
              </details>
              {doc.documentDecision && <p className={pipelineStyles.receipt}>{t(doc.docStatus === 'accepted' ? 'Acceptation enregistrée' : 'Refus enregistré')} · {doc.documentDecision.by} · {fmt(doc.documentDecision.at, true)}</p>}
              {mode === 'client' && doc.docStatus === 'sent' && doc.docType !== 'facture' && <div className={pipelineStyles.decisionActions}><button type="button" className="btn primary" onClick={() => { setDecidingDocument(doc); setDocumentRead(false); }}>{t('Répondre au document')}</button></div>}
              </div></Surface>
            );
          })}
        </div>
      ) : (
        <div className="ph-empty">
          <FileSignature size={40} style={{opacity: 0.5}} />
          <div style={{marginTop: 8}}>
            <strong style={{fontSize: 18, color: 'var(--t-text)', display: 'block', marginBottom: 4}}>Aucun document</strong>
            <span style={{color: 'var(--t-text-muted)'}}>Vous n&apos;avez pas encore de factures ou devis.</span>
          </div>
        </div>
      )}
      <Dialog open={!!decidingDocument} onOpenChange={open => { if (!open && !documentSaving) setDecidingDocument(null); }}><DialogContent className="tracker-modal document-modal">
        <DialogHeader><DialogTitle>{decidingDocument?.number}</DialogTitle><DialogDescription>{t('Lisez le périmètre et le prix avant de donner votre accord. Le silence ne vaut pas acceptation de ce document.')}</DialogDescription></DialogHeader>
        {decidingDocument && <div className={pipelineStyles.documentInfo}>
          <ul>{decidingDocument.lineItems?.map((line, i) => <li key={i}>{line.quantity} × {line.description} · {(line.quantity * line.unitPrice).toFixed(2)} MAD HT</li>)}</ul>
          <p>{(decidingDocument.taxRate ?? 0) > 0 ? `${t('TVA')} : ${decidingDocument.taxRate} %` : t('Sans TVA')}</p>
          <strong>{t('Total')} : {computeTotals(decidingDocument.lineItems, decidingDocument.taxRate).total.toFixed(2)} MAD{(decidingDocument.taxRate ?? 0) > 0 ? ' TTC' : ''}</strong>
          {decidingDocument.serviceScope && <ScopeSummary scope={decidingDocument.serviceScope} workflow={decidingDocument.workflowTerms} />}
          {decidingDocument.notes && <p className="document-copy">{decidingDocument.notes}</p>}
          <label className={pipelineStyles.decision}><span><input type="checkbox" checked={documentRead} onChange={e => setDocumentRead(e.target.checked)} /> {t('J’ai lu les quantités, le prix et les conditions de ce document.')}</span></label>
          <DialogFooter className="modal-footer"><button type="button" className="btn" disabled={documentSaving} onClick={() => void decideDocument('refused')}>{t('Refuser')}</button><button type="button" className="btn primary" disabled={!documentRead || documentSaving} onClick={() => void decideDocument('accepted')}>{documentSaving && <Loader2 size={15} className="spin" />}{t('Accepter le document')}</button></DialogFooter>
        </div>}
      </DialogContent></Dialog>
    </div>
  );
}