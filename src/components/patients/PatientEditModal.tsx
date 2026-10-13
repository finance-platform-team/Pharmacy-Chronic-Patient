import { useEffect, useState } from 'react';
import { LookupInput } from '../ui/LookupInput';
import { searchUsers } from '../../api/usersApi';
import { getPatientById, updatePatientUser } from '../../api/patientsApi';
import type { LookupOption } from '../../api/businessUnitsApi';
import type { Patient } from '../../domain/types';
import { formatDayMonth } from '../../domain/dates';

interface PatientEditModalProps {
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
}

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PatientEditModal({ patientId, onClose, onSaved }: PatientEditModalProps) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<LookupOption | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPatientById(patientId)
      .then((p) => {
        if (cancelled) return;
        setPatient(p);
        setSelectedUser(p.userId && p.userName ? { id: p.userId, name: p.userName } : null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load patient');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  const originalUserId = patient?.userId ?? null;
  const hasChanged = (selectedUser?.id ?? null) !== originalUserId;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updatePatientUser(patientId, selectedUser?.id ?? null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box wide">
        <div className="modal-header">
          <div>
            <h1 className="modal-title">{patient?.name ?? '—'}</h1>
            <div className="modal-subtitle">Patient</div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {loading && <div className="modal-loading">Loading patient…</div>}
          {error && <div className="modal-error">{error}</div>}

          {!loading && patient && (
            <div className="modal-columns">
              <div className="section-card">
                <div className="form-field">
                  <label className="field-lbl">Patient Name</label>
                  <div className="field-readonly">{patient.name}</div>
                </div>
                <div className="form-field">
                  <label className="field-lbl">Business Unit</label>
                  <div className="field-readonly">{patient.businessUnitName ?? '—'}</div>
                </div>
                <div className="form-field">
                  <label className="field-lbl">Phone Number</label>
                  <div className="field-readonly mono">{patient.phoneNumber}</div>
                </div>
                <div className="form-field">
                  <label className="field-lbl">User</label>
                  <LookupInput
                    placeholder="Search a user…"
                    initialValue={selectedUser}
                    onSelect={setSelectedUser}
                    searchFn={searchUsers}
                  />
                </div>
                <div className="form-field">
                  <label className="field-lbl">No. of Prescriptions</label>
                  <div className="field-readonly mono">{patient.noOfPrescriptions ?? '—'}</div>
                </div>
                <div className="form-field">
                  <label className="field-lbl">Total Dispensing Value</label>
                  <div className="field-readonly mono">{formatMoney(patient.totalDispensingValue)}</div>
                </div>
                <div className="form-field">
                  <label className="field-lbl">Order Date</label>
                  <div className="field-readonly">{formatDayMonth(patient.orderDay)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanged || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}