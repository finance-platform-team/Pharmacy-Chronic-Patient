import { useState, useEffect } from 'react';
import { getPatientById } from '../../api/patientsApi';
import { getPrescriptionsByPatientId } from '../../api/prescriptionsApi';
import { getProductsByPrescriptionIds } from '../../api/productsApi';
import { searchUsers } from '../../api/usersApi';
import { LookupInput } from '../ui/LookupInput';
import { DocumentsUploader } from '../ui/DocumentsUploader';
import { Toast } from '../ui/Toast';
import { useToast } from '../../hooks/useToast';
import type { Patient, PrescriptionSummary, ProductSummary } from '../../domain/types';
import type { LookupOption } from '../../api/businessUnitsApi';
import { formatDayMonth } from '../../domain/dates';

interface PatientDetailsPanelProps {
  patientId: string;
  onClose: () => void;
  onAssign: (patientId: string, option: LookupOption | null) => void;
  assigning: boolean;
}

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function chronicClass(status: string | null): string {
  if (status === 'Active Chronic') return 'pill-live';
  if (status === 'Inactive Chronic') return 'pill-muted';
  return 'pill-neutral';
}

export function PatientDetailsPanel({ patientId, onClose, onAssign, assigning }: PatientDetailsPanelProps) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionSummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { toast, showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const p = await getPatientById(patientId);
        if (cancelled) return;
        setPatient(p);

        const rx = await getPrescriptionsByPatientId(patientId);
        if (cancelled) return;
        setPrescriptions(rx);

        const prods = await getProductsByPrescriptionIds(rx.map((r) => r.id));
        if (cancelled) return;
        setProducts(prods);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load details');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [patientId]);

  function productsFor(prescriptionId: string): ProductSummary[] {
    return products.filter((p) => p.prescriptionId === prescriptionId);
  }

  // Mirrors the grid's own assign-user handling: reflect the pick locally right
  // away, then let the shared onAssign (same handler the grid uses) do the
  // real write — no waiting on a refetch to see the change stick.
  function handleAssignInPanel(option: LookupOption | null) {
    if (!patient) return;
    setPatient({ ...patient, userId: option?.id ?? null, userName: option?.name ?? null });
    onAssign(patient.id, option);
  }

  return (
    <div className="side-panel-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="side-panel side-panel-accent">
        <div className="side-panel-header">
          <div>
            <h1 className="side-panel-title">{patient?.name ?? '—'}</h1>
            <div className="side-panel-subtitle">Patient Details</div>
          </div>
          <button className="side-panel-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="side-panel-body">
          {loading && <div className="modal-loading">Loading…</div>}
          {error && <div className="modal-error">{error}</div>}

          {!loading && !error && patient && (
            <>
              <div className="chip-row">
                <span className="detail-chip mono">{patient.phoneNumber}</span>
                {patient.businessUnitName && (
                  <span className="detail-chip"><span className="detail-chip-tag">BU</span> {patient.businessUnitName}</span>
                )}
                {patient.insuranceCompany && <span className="detail-chip">{patient.insuranceCompany}</span>}
                {patient.pharmacyName && <span className="detail-chip">{patient.pharmacyName}</span>}
                {patient.chronicPatientType && <span className="detail-chip">{patient.chronicPatientType}</span>}
                <span className="detail-chip mono">{patient.noOfPrescriptions ?? 0} Rx</span>
                <span className="detail-chip mono">{formatMoney(patient.totalDispensingValue)}</span>
                {patient.orderDay && <span className="detail-chip">Order {formatDayMonth(patient.orderDay)}</span>}
                <span className="detail-chip mono">Created {formatDate(patient.createdOn)}</span>
              </div>

              <div className="section-card">
                <div className="section-title-row">
                  <div className="section-title" style={{ margin: 0 }}>Prescriptions &amp; Products</div>
                  <span className="field-sub" style={{ margin: 0 }}>{prescriptions.length} prescription{prescriptions.length === 1 ? '' : 's'}</span>
                </div>

                {prescriptions.length === 0 && (
                  <div className="modal-loading">No prescriptions found for this patient.</div>
                )}

                {prescriptions.map((rx) => (
                  <div key={rx.id} className="rx-card">
                    <div className="rx-header-row">
                      <div className="rx-name">{rx.name}</div>
                      {rx.chronicStatus && <span className={`pill ${chronicClass(rx.chronicStatus)}`}>{rx.chronicStatus}</span>}
                    </div>

                    <div className="rx-fields-grid">
                      <div><strong>Dispensed:</strong> {rx.dispensed ? 'Yes' : 'No'}</div>
                      <div><strong>Dispensed Value:</strong> {formatMoney(rx.dispensedValue)}</div>
                      <div><strong>Monthly Dispensing Date:</strong> <span className="rx-field-muted">{formatDate(rx.monthlyDispensingDate)}</span></div>
                      <div><strong>Eligibility:</strong> <span className="rx-field-muted">{rx.eligibility ?? '—'}</span></div>
                    </div>

                    {productsFor(rx.id).length === 0 ? (
                      <div style={{ padding: '14px', textAlign: 'center', color: 'var(--dim)', fontSize: 11, borderRadius: 'var(--r-md)', background: 'rgba(0, 0, 0, 0.02)' }}>No products for this prescription.</div>
                    ) : (
                      <div className="rx-product-list">
                        {productsFor(rx.id).map((p) => (
                          <div key={p.id} className="rx-product-row">
                            <span className="rx-product-name">{p.name ?? '—'}</span>
                            <span className="rx-product-qty">Qty {p.quantity ?? '—'}</span>
                            <span className="rx-product-price">{formatMoney(p.salesPrice)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="section-card">
                <div className="section-title">Assigned To</div>
                <LookupInput
                  placeholder="Search a user…"
                  initialValue={patient.userId && patient.userName ? { id: patient.userId, name: patient.userName } : null}
                  onSelect={handleAssignInPanel}
                  searchFn={searchUsers}
                  disabled={assigning}
                  showAvatar
                />
              </div>

              <div className="section-card">
                <DocumentsUploader patientId={patient.id} onNotify={showToast} />
              </div>
            </>
          )}
        </div>

        <div className="side-panel-footer">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
