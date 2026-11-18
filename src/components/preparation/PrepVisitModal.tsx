import { useMemo, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faPen, faPlus, faPrint, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { createProduct, deleteProduct, getProductsByPrescriptionIds, updateProduct, type ProductInput } from '../../api/productsApi';
import type { PrepVisitDetails } from '../../api/prepVisitApi';
import { updateTaskNotes, type PreparationTask } from '../../api/preparationApi';
import type { ProductSummary } from '../../domain/types';
import {
  PREP_STATUS_MEDICATION_RECORDED, nextStage, prepSteps, stageIndex, stageLabel, stageOf
} from '../../domain/prepStages';
import './PrepVisitModal.css';

interface ProductDraft {
  name: string;
  itemId: string;
  quantity: string;
  salesPrice: string;
}

// One editable medication row. Nothing is written to Dataverse until Save —
// new rows have no productId yet, and deleted rows stay listed (struck
// through, with Undo) until then.
interface DraftRow extends ProductDraft {
  key: string;
  productId: string | null;
  prescriptionId: string;
  deleted: boolean;
  original: ProductDraft | null;
}

function toDraft(p: ProductSummary): ProductDraft {
  return {
    name: p.name ?? '',
    itemId: p.itemId ?? '',
    quantity: p.quantity != null ? String(p.quantity) : '',
    salesPrice: p.salesPrice != null ? String(p.salesPrice) : ''
  };
}

function toRows(products: ProductSummary[]): DraftRow[] {
  return products.map((p) => {
    const draft = toDraft(p);
    return { ...draft, key: p.id, productId: p.id, prescriptionId: p.prescriptionId, deleted: false, original: draft };
  });
}

function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInput(d: ProductDraft): ProductInput {
  return {
    name: d.name.trim(),
    itemId: d.itemId.trim() || null,
    quantity: toNumber(d.quantity),
    salesPrice: toNumber(d.salesPrice)
  };
}

function isEdited(row: DraftRow): boolean {
  if (!row.original) return true;
  return row.name !== row.original.name
    || row.itemId !== row.original.itemId
    || row.quantity !== row.original.quantity
    || row.salesPrice !== row.original.salesPrice;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

interface PrepVisitModalProps {
  task: PreparationTask;
  details: PrepVisitDetails;
  onClose: () => void;
  onNotesSaved: (notes: string) => void;
  /** Persists a new chp_prepstatus value; rejects on failure. */
  onStageChange: (status: string) => Promise<void>;
}

export function PrepVisitModal({ task, details, onClose, onNotesSaved, onStageChange }: PrepVisitModalProps) {
  const { patient, prescriptions } = details;
  const [rows, setRows] = useState<DraftRow[]>(() => toRows(details.products));
  const [savedNotes, setSavedNotes] = useState(task.notes ?? '');
  const [notes, setNotes] = useState(task.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [changingStage, setChangingStage] = useState(false);
  const [editingKeys, setEditingKeys] = useState<Set<string>>(() => new Set());

  const stage = stageOf(task.prepStatus);
  const reached = stageIndex(stage);
  const next = nextStage(task.prepStatus, task.fulfilmentPath);
  const steps = prepSteps(task.fulfilmentPath);

  // The cycle's own prescription first, the rest of the visit after it.
  const orderedPrescriptions = useMemo(() => [...prescriptions].sort((a, b) =>
    Number(b.id === task.prescriptionId) - Number(a.id === task.prescriptionId)
  ), [prescriptions, task.prescriptionId]);

  const pending = useMemo(() => ({
    creates: rows.filter((r) => !r.productId && !r.deleted),
    updates: rows.filter((r) => r.productId && !r.deleted && isEdited(r)),
    deletes: rows.filter((r) => r.productId && r.deleted)
  }), [rows]);
  const notesChanged = notes.trim() !== savedNotes.trim();
  const hasChanges = pending.creates.length + pending.updates.length + pending.deletes.length > 0 || notesChanged;

  function updateRow(key: string, field: keyof ProductDraft, value: string) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    setMessage(null);
  }

  // Rows show as plain text; Edit turns just that row into inputs. Its changes
  // stay pending (highlighted) until Save, even after Done collapses it again.
  function toggleEditing(key: string) {
    setEditingKeys((current) => {
      const nextKeys = new Set(current);
      if (nextKeys.has(key)) nextKeys.delete(key);
      else nextKeys.add(key);
      return nextKeys;
    });
  }

  function addRow(prescriptionId: string) {
    const key = `new-${crypto.randomUUID()}`;
    setRows((current) => [...current, {
      key, productId: null, prescriptionId, deleted: false, original: null,
      name: '', itemId: '', quantity: '1', salesPrice: ''
    }]);
    setEditingKeys((current) => new Set(current).add(key));
    setMessage(null);
  }

  // A row that was never saved just disappears; a saved one is marked for deletion until Save.
  function toggleDelete(row: DraftRow) {
    setRows((current) => (row.productId
      ? current.map((r) => (r.key === row.key ? { ...r, deleted: !r.deleted } : r))
      : current.filter((r) => r.key !== row.key)));
    setMessage(null);
  }

  function requestClose() {
    if (hasChanges && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onClose();
  }

  async function handleSave() {
    const missingName = [...pending.creates, ...pending.updates].find((r) => !r.name.trim());
    if (missingName) {
      setMessage({ tone: 'error', text: 'Every medication needs a name before saving.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      for (const row of pending.deletes) {
        await deleteProduct(row.productId!);
      }
      for (const row of pending.updates) {
        await updateProduct(row.productId!, toInput(row));
      }
      for (const row of pending.creates) {
        await createProduct(row.prescriptionId, toInput(row));
      }
      if (notesChanged) {
        await updateTaskNotes(task.id, notes.trim());
        setSavedNotes(notes.trim());
        onNotesSaved(notes.trim());
      }
      // Recording medications moves a cycle that is not started / Called on to Medication Recorded.
      const recordedMedication = pending.creates.length + pending.updates.length > 0;
      if (recordedMedication && (stage === 'none' || stage === 'called')) {
        await onStageChange(PREP_STATUS_MEDICATION_RECORDED);
      }
      setMessage({ tone: 'success', text: 'Saved to Dataverse' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to save changes' });
    } finally {
      // Re-read either way so the table shows exactly what is in Dataverse —
      // after a partial failure some rows may already have been written.
      try {
        setRows(toRows(await getProductsByPrescriptionIds(prescriptions.map((p) => p.id))));
        setEditingKeys(new Set());
      } catch {
        // keep the local rows if the reload itself fails
      }
      setSaving(false);
    }
  }

  async function advanceStage() {
    if (!next) return;
    setChangingStage(true);
    setMessage(null);
    try {
      await onStageChange(next.status);
      setMessage({ tone: 'success', text: `Stage updated to ${stageLabel(next.status)}` });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to update stage' });
    } finally {
      setChangingStage(false);
    }
  }

  // Prints the A5 layout rendered into document.body below (see PrepVisitModal.css
  // @media print). Only saved data is printed, so unsaved edits block it.
  function handlePrint() {
    if (hasChanges) {
      setMessage({ tone: 'error', text: 'Save your changes before printing.' });
      return;
    }
    try {
      window.print();
    } catch (err) {
      setMessage({ tone: 'error', text: `Printing failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const printRows = rows.filter((r) => !r.deleted);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="modal-box wide prep-visit-modal">
        <div className="modal-header">
          <div>
            <h1 className="modal-title">{patient.name ?? '—'}</h1>
            <div className="modal-subtitle">Pharmacy Visit {task.pharmacyVisitId ?? '—'}</div>
          </div>
          <button className="modal-close" onClick={requestClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="section-card">
            <div className="visit-stage-head">
              <h2 className="section-title">Preparation Status</h2>
              {next && (
                <button type="button" className="btn btn-primary btn-sm" onClick={advanceStage} disabled={changingStage || saving}>
                  {changingStage ? 'Updating…' : (<><FontAwesomeIcon icon={faCheck} aria-hidden="true" /> {next.label}</>)}
                </button>
              )}
            </div>
            <ol className="visit-stage-bar">
              {steps.map((step, i) => {
                const state = i + 1 < reached || stage === 'fulfilled' ? 'done' : i + 1 === reached ? 'current' : '';
                return (
                  <li key={step.stage} className={`visit-stage ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                    <span className="visit-stage-dot">{state === 'done' ? '✓' : i + 1}</span>
                    <span className="visit-stage-label">{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="section-card">
            <h2 className="section-title">Patient</h2>
            <div className="visit-info-grid">
              <div className="form-field"><span className="field-lbl">Name</span><div className="field-readonly">{patient.name ?? '—'}</div></div>
              <div className="form-field"><span className="field-lbl">Mobile</span><div className="field-readonly mono">{patient.phoneNumber ?? '—'}</div></div>
              <div className="form-field"><span className="field-lbl">BU</span><div className="field-readonly">{patient.businessUnitName ?? task.bu ?? '—'}</div></div>
              <div className="form-field"><span className="field-lbl">Chronic Status</span><div className="field-readonly">{patient.chronicStatus ?? '—'}</div></div>
              <div className="form-field"><span className="field-lbl">Insurance</span><div className="field-readonly">{patient.insuranceCompany ?? '—'}</div></div>
              <div className="form-field"><span className="field-lbl">OPD Visit</span><div className="field-readonly mono">{patient.opdVisit ?? '—'}</div></div>
            </div>
          </div>

          {orderedPrescriptions.map((rx) => {
            const rxRows = rows.filter((r) => r.prescriptionId === rx.id);
            const total = rxRows
              .filter((r) => !r.deleted)
              .reduce((sum, r) => sum + (toNumber(r.salesPrice) ?? 0) * (toNumber(r.quantity) ?? 1), 0);
            return (
              <div className="section-card visit-rx-card" key={rx.id}>
                <div className="visit-rx-head">
                  <h2 className="section-title">
                    Prescription {rx.name}
                    {rx.id === task.prescriptionId && <span className="visit-rx-current">This cycle</span>}
                  </h2>
                  <span className="visit-rx-meta">{formatDate(rx.monthlyDispensingDate)}</span>
                </div>

                <table className="visit-products">
                  <colgroup>
                    <col />
                    <col className="col-item" />
                    <col className="col-qty" />
                    <col className="col-price" />
                    <col className="col-action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Medication</th>
                      <th>Item ID</th>
                      <th className="num">Qty</th>
                      <th className="num">Sales Price</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rxRows.length === 0 && (
                      <tr><td colSpan={5} className="visit-empty">No medications recorded yet.</td></tr>
                    )}
                    {rxRows.map((row) => {
                      const set = (field: keyof ProductDraft) => (e: ChangeEvent<HTMLInputElement>) => updateRow(row.key, field, e.target.value);
                      const state = row.deleted ? 'is-deleted' : !row.productId ? 'is-new' : isEdited(row) ? 'is-edited' : '';
                      const editing = editingKeys.has(row.key) && !row.deleted;
                      return (
                        <tr key={row.key} className={state}>
                          {editing
                            ? (
                              <>
                                <td><input className="field-input" placeholder="Medication name" value={row.name} onChange={set('name')} disabled={saving} autoFocus /></td>
                                <td><input className="field-input mono" placeholder="Item ID" value={row.itemId} onChange={set('itemId')} disabled={saving} /></td>
                                <td><input className="field-input num" type="number" min="0" value={row.quantity} onChange={set('quantity')} disabled={saving} /></td>
                                <td><input className="field-input num" type="number" min="0" step="0.01" placeholder="0.00" value={row.salesPrice} onChange={set('salesPrice')} disabled={saving} /></td>
                              </>
                            )
                            : (
                              <>
                                <td className="visit-cell-text">{row.name || '—'}</td>
                                <td className="mono">{row.itemId || '—'}</td>
                                <td className="num">{row.quantity || '—'}</td>
                                <td className="num mono">{row.salesPrice ? formatMoney(toNumber(row.salesPrice) ?? 0) : '—'}</td>
                              </>
                            )}
                          <td className="visit-actions">
                            {!row.deleted && (
                              <button
                                type="button"
                                className="visit-icon-btn"
                                title={editing ? 'Done editing' : 'Edit medication'}
                                aria-label={editing ? 'Done editing' : 'Edit medication'}
                                onClick={() => toggleEditing(row.key)}
                                disabled={saving}
                              >
                                <FontAwesomeIcon icon={editing ? faCheck : faPen} aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              className={`visit-icon-btn${row.deleted ? '' : ' danger'}`}
                              title={row.deleted ? 'Undo delete' : 'Delete medication'}
                              aria-label={row.deleted ? 'Undo delete' : 'Delete medication'}
                              onClick={() => toggleDelete(row)}
                              disabled={saving}
                            >
                              <FontAwesomeIcon icon={row.deleted ? faRotateLeft : faTrash} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => addRow(rx.id)} disabled={saving}>
                          <FontAwesomeIcon icon={faPlus} aria-hidden="true" /> Add medication
                        </button>
                      </td>
                      <td className="num mono visit-total">{formatMoney(total)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}

          <div className="section-card">
            <h2 className="section-title">Preparation Notes</h2>
            <textarea
              className="field-input visit-notes"
              rows={3}
              placeholder="Notes about this preparation cycle…"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setMessage(null); }}
              disabled={saving}
            />
          </div>
        </div>

        <div className="modal-footer visit-footer">
          {message
            ? <span className={`visit-message ${message.tone}`} role="status">{message.tone === 'success' ? '✓ ' : ''}{message.text}</span>
            : hasChanges && <span className="visit-message pending">Unsaved changes</span>}
          <button className="btn btn-outline" onClick={handlePrint} disabled={saving}>
            <FontAwesomeIcon icon={faPrint} aria-hidden="true" /> Print
          </button>
          <button className="btn btn-outline" onClick={requestClose} disabled={saving}>Close</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {createPortal(
        <div className="visit-print" aria-hidden="true">
          <header className="vp-head">
            <div>
              <div className="vp-title">{patient.name ?? '—'}</div>
              <div className="vp-sub">Pharmacy Visit {task.pharmacyVisitId ?? '—'}</div>
            </div>
            <div className="vp-status">{stageLabel(task.prepStatus)}</div>
          </header>

          <section>
            <h3>Patient Information</h3>
            <dl className="vp-info">
              <dt>Mobile</dt><dd>{patient.phoneNumber ?? '—'}</dd>
              <dt>BU</dt><dd>{patient.businessUnitName ?? task.bu ?? '—'}</dd>
              <dt>Chronic Status</dt><dd>{patient.chronicStatus ?? '—'}</dd>
              <dt>Insurance</dt><dd>{patient.insuranceCompany ?? '—'}</dd>
              <dt>OPD Visit</dt><dd>{patient.opdVisit ?? '—'}</dd>
              <dt>Fulfilment</dt><dd>{task.fulfilmentPath ?? '—'}</dd>
            </dl>
          </section>

          <section>
            <h3>Preparation Status</h3>
            <ol className="vp-stages">
              {steps.map((step, i) => (
                <li key={step.stage} className={i + 1 <= reached ? 'reached' : undefined}>{step.label}</li>
              ))}
            </ol>
          </section>

          {orderedPrescriptions.map((rx) => {
            const rxRows = printRows.filter((r) => r.prescriptionId === rx.id);
            const total = rxRows.reduce((sum, r) => sum + (toNumber(r.salesPrice) ?? 0) * (toNumber(r.quantity) ?? 1), 0);
            return (
              <section key={rx.id}>
                <h3>Prescription {rx.name}{rx.monthlyDispensingDate ? ` — ${formatDate(rx.monthlyDispensingDate)}` : ''}</h3>
                <table className="vp-table">
                  <thead>
                    <tr><th>#</th><th>Medication</th><th>Item ID</th><th className="num">Qty</th><th className="num">Price</th></tr>
                  </thead>
                  <tbody>
                    {rxRows.length === 0 && <tr><td colSpan={5}>No medications recorded.</td></tr>}
                    {rxRows.map((r, i) => (
                      <tr key={r.key}>
                        <td>{i + 1}</td>
                        <td>{r.name}</td>
                        <td>{r.itemId || '—'}</td>
                        <td className="num">{r.quantity || '—'}</td>
                        <td className="num">{r.salesPrice || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={4}>Total</td><td className="num">{formatMoney(total)}</td></tr>
                  </tfoot>
                </table>
              </section>
            );
          })}

          <section>
            <h3>Pharmacist Notes</h3>
            <p className="vp-notes">{savedNotes || '—'}</p>
          </section>

          <footer className="vp-foot">Printed {new Date().toLocaleString()}</footer>
        </div>,
        document.body
      )}
    </div>
  );
}
