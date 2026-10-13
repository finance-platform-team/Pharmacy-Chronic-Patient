import { useState } from 'react';
import { LookupInput } from '../ui/LookupInput';
import { searchUsers } from '../../api/usersApi';
import type { LookupOption } from '../../api/businessUnitsApi';

interface BulkEditUserModalProps {
  count: number;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (option: LookupOption | null) => void;
}

export function BulkEditUserModal({ count, saving, error, onCancel, onSave }: BulkEditUserModalProps) {
  const [selectedUser, setSelectedUser] = useState<LookupOption | null>(null);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onCancel()}>
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <h1 className="modal-title">Bulk Edit User</h1>
            <div className="modal-subtitle">{count} record{count === 1 ? '' : 's'} selected</div>
          </div>
          <button className="modal-close" onClick={onCancel} disabled={saving}>&times;</button>
        </div>

        <div className="modal-body">
          {error && <div className="modal-error" style={{ padding: '10px 0', justifyContent: 'flex-start' }}>{error}</div>}

          <div className="form-field">
            <label className="field-lbl">Assign To User</label>
            <LookupInput
              placeholder="Search a user…"
              initialValue={selectedUser}
              onSelect={setSelectedUser}
              searchFn={searchUsers}
              disabled={saving}
            />
            <div className="field-sub">This user will be assigned to all {count} selected record{count === 1 ? '' : 's'}.</div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(selectedUser)} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
