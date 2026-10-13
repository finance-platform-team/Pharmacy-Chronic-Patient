import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faCircleNotch, faTriangleExclamation, faRotateRight, faFile, faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { uploadPatientDocument, listPatientDocuments, deletePatientDocument } from '../../api/patientDocumentsApi';

interface SavedDoc {
  key: string;
  name: string;
  url: string | null;
  /** The SharePoint {Identifier} — required to delete this doc via the flow. */
  path: string | null;
  size: number | null;
  status: 'saved' | 'deleting';
}

interface StagedFile {
  key: string;
  file: File;
  /** Only set for images — blob URL used as a thumbnail before upload. */
  previewUrl: string | null;
  status: 'staged' | 'uploading' | 'error';
  errorMessage?: string;
}

interface DocumentsUploaderProps {
  patientId: string;
  /** Reports upload/delete/list outcomes so the host can surface them via its own toast. */
  onNotify?: (message: string, tone: 'success' | 'error') => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — the flow expects raw base64.
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * SharePoint document attachments for a patient, via the Power Automate flow
 * in src/api/patientDocumentsApi.ts. Folder name is the patient's Dataverse id
 * (stable and unique, unlike the display name) — flag this to the team if the
 * flow expects a different folder-naming convention.
 *
 * Selecting/dropping a file only stages it locally with a preview (thumbnail
 * for images, file icon otherwise) — nothing is sent until Save is clicked.
 */
export function DocumentsUploader({ patientId, onNotify }: DocumentsUploaderProps) {
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // Set only for a background refresh (after upload/delete) when the list
  // already has content on screen — keeps existing rows visible instead of
  // swapping the whole section for a loading state, while still blocking
  // Delete until the fresh, authoritative list (with real SharePoint paths)
  // has loaded.
  const [refreshing, setRefreshing] = useState(false);

  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const blobUrlsRef = useRef<Set<string>>(new Set());
  function trackBlobUrl(url: string) {
    blobUrlsRef.current.add(url);
    return url;
  }
  function releaseBlobUrl(url: string) {
    blobUrlsRef.current.delete(url);
    URL.revokeObjectURL(url);
  }
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Guards against the flow's "list" action firing twice for the same patient —
  // React 18 StrictMode (dev only) mounts, cleans up, then re-mounts every
  // component once, running this effect's body twice in immediate succession.
  // A ref set synchronously before the first `await` lets the second run detect
  // "already in flight for this patient" and skip re-calling the flow, instead
  // of the two invocations both actually hitting the network.
  const loadingForRef = useRef<string | null>(null);

  async function loadDocuments() {
    if (loadingForRef.current === patientId) return;
    loadingForRef.current = patientId;

    // Only show the full "Loading documents…" state on a cold load (nothing
    // on screen yet) — a post-upload/post-delete refresh keeps the existing
    // rows visible and just blocks Delete via `refreshing` instead.
    if (savedDocs.length === 0) setListLoading(true);
    else setRefreshing(true);
    setListError(null);
    try {
      // SharePoint (via the flow's "list" action) is the source of truth for
      // document identifiers — this fully replaces savedDocs rather than
      // patching it, so every row's `path` always reflects the freshest
      // SharePoint {Identifier}, never a locally-constructed value.
      const docs = await listPatientDocuments(patientId);
      setSavedDocs(docs.map((d) => ({ key: d.path, name: d.name, url: d.url, path: d.path, size: d.size, status: 'saved' as const })));
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setListLoading(false);
      setRefreshing(false);
      loadingForRef.current = null;
    }
  }

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const newlyStaged: StagedFile[] = files.map((file) => ({
      key: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: file.type.startsWith('image/') ? trackBlobUrl(URL.createObjectURL(file)) : null,
      status: 'staged'
    }));
    setStaged((prev) => [...prev, ...newlyStaged]);
  }

  function removeStaged(key: string) {
    setStaged((prev) => {
      const item = prev.find((s) => s.key === key);
      if (item?.previewUrl) releaseBlobUrl(item.previewUrl);
      return prev.filter((s) => s.key !== key);
    });
  }

  // Does NOT add the uploaded file to savedDocs itself — the upload
  // response's path isn't treated as authoritative (it can be stale/not yet
  // reflect SharePoint's own indexed {Identifier}, which is what caused
  // "Delete" to fail immediately after an upload). Callers must follow this
  // with loadDocuments() once all their uploads have settled, so every doc
  // — including the one just uploaded — gets its path from a fresh "list"
  // call instead.
  async function saveOne(item: StagedFile) {
    setStaged((prev) => prev.map((s) => (s.key === item.key ? { ...s, status: 'uploading', errorMessage: undefined } : s)));

    try {
      const base64 = await fileToBase64(item.file);
      await uploadPatientDocument(base64, item.file.name, patientId);

      setStaged((prev) => prev.filter((s) => s.key !== item.key));
      if (item.previewUrl) releaseBlobUrl(item.previewUrl);
      onNotify?.(`${item.file.name} uploaded`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setStaged((prev) => prev.map((s) => (s.key === item.key ? { ...s, status: 'error', errorMessage: message } : s)));
      onNotify?.(`Failed to upload ${item.file.name}: ${message}`, 'error');
    }
  }

  // Re-clicking Save also retries anything that previously failed — no separate
  // per-row retry control needed, one action covers both cases.
  const pendingToSave = staged.filter((s) => s.status === 'staged' || s.status === 'error');
  const uploadingCount = staged.filter((s) => s.status === 'uploading').length;

  async function handleSaveAll() {
    if (pendingToSave.length === 0) return;
    await Promise.all(pendingToSave.map((item) => saveOne(item)));
    // Wait for the fresh list before considering the UI synchronized — the
    // newly uploaded file(s) only appear once this resolves, each carrying
    // the real SharePoint path a subsequent Delete click needs.
    await loadDocuments();
  }

  async function retryOne(item: StagedFile) {
    await saveOne(item);
    await loadDocuments();
  }

  async function removeSaved(doc: SavedDoc) {
    // doc.path is the SharePoint {Identifier} the "list"/"upload" actions
    // returned for this file — required as-is for the delete flow's
    // `filePath`. Validate before calling the flow at all.
    const filePath = doc.path;
    if (!filePath || !filePath.trim()) {
      console.error('Cannot delete document — missing SharePoint file path (Identifier). Selected file:', doc);
      onNotify?.(`Can't delete ${doc.name}: its SharePoint file path is unavailable.`, 'error');
      return;
    }

    setSavedDocs((prev) => prev.map((d) => (d.key === doc.key ? { ...d, status: 'deleting' } : d)));
    try {
      await deletePatientDocument(patientId, filePath);
      setSavedDocs((prev) => prev.filter((d) => d.key !== doc.key));
      onNotify?.(`${doc.name} deleted`, 'success');
      await loadDocuments();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setSavedDocs((prev) => prev.map((d) => (d.key === doc.key ? { ...d, status: 'saved' } : d)));
      onNotify?.(`Failed to delete ${doc.name}: ${message}`, 'error');
    }
  }

  function previewUrl(url: string | null) {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  return (
    <div>
      <div className="section-title-row">
        <div className="section-title" style={{ margin: 0 }}>Documents</div>
        <span className="field-sub" style={{ margin: 0 }}>{savedDocs.length} file{savedDocs.length === 1 ? '' : 's'}</span>
      </div>

      {listLoading && <div className="modal-loading">Loading documents…</div>}
      {!listLoading && listError && (
        <div className="doc-row" style={{ marginBottom: 10 }}>
          <div className="doc-info">
            <span className="doc-error"><FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" /> {listError}</span>
          </div>
          <div className="doc-actions">
            <button type="button" className="doc-preview-btn" onClick={() => void loadDocuments()} aria-label="Retry loading documents">
              <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {!listLoading && savedDocs.map((doc) => (
        <div key={doc.key} className="doc-row" style={{ marginBottom: 10 }}>
          <div className="doc-row-inner">
            <span className="doc-thumb-icon"><FontAwesomeIcon icon={faFile} aria-hidden="true" /></span>
            <div className="doc-info">
              <span className="doc-name">{doc.name}</span>
              {doc.status === 'deleting'
                ? <span className="doc-file"><FontAwesomeIcon icon={faCircleNotch} className="doc-spin" aria-hidden="true" /> Deleting…</span>
                : doc.size !== null && <span className="doc-file">{formatFileSize(doc.size)}</span>}
            </div>
          </div>
          <div className="doc-actions">
            <button
              type="button"
              className="doc-preview-btn"
              onClick={() => previewUrl(doc.url)}
              disabled={!doc.url}
              aria-label={`Preview ${doc.name}`}
            >
              <FontAwesomeIcon icon={faEye} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="doc-remove-x"
              onClick={() => void removeSaved(doc)}
              disabled={doc.status === 'deleting' || refreshing}
              aria-label={`Remove ${doc.name}`}
            >
              &times;
            </button>
          </div>
        </div>
      ))}

      {staged.length > 0 && (
        <div className="doc-staged-section">
          <div className="doc-staged-label">Ready to upload</div>
          {staged.map((item) => (
            <div key={item.key} className="doc-row doc-row-staged" style={{ marginBottom: 10 }}>
              <div className="doc-row-inner">
                {item.previewUrl
                  ? <img className="doc-thumb" src={item.previewUrl} alt="" />
                  : <span className="doc-thumb-icon"><FontAwesomeIcon icon={faFile} aria-hidden="true" /></span>}
                <div className="doc-info">
                  <span className="doc-name">{item.file.name}</span>
                  {item.status === 'uploading' && (
                    <span className="doc-file"><FontAwesomeIcon icon={faCircleNotch} className="doc-spin" aria-hidden="true" /> Uploading…</span>
                  )}
                  {item.status === 'error' && (
                    <span className="doc-error"><FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" /> {item.errorMessage}</span>
                  )}
                  {item.status === 'staged' && (
                    <span className="doc-file">{formatFileSize(item.file.size)}</span>
                  )}
                </div>
              </div>
              <div className="doc-actions">
                {item.status === 'error' && (
                  <button type="button" className="doc-preview-btn" onClick={() => void retryOne(item)} aria-label={`Retry uploading ${item.file.name}`}>
                    <FontAwesomeIcon icon={faRotateRight} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="doc-remove-x"
                  onClick={() => removeStaged(item.key)}
                  disabled={item.status === 'uploading'}
                  aria-label={`Remove ${item.file.name}`}
                >
                  &times;
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-primary doc-save-btn"
            onClick={() => void handleSaveAll()}
            disabled={pendingToSave.length === 0 || uploadingCount > 0}
          >
            {uploadingCount > 0 ? (
              <><FontAwesomeIcon icon={faCircleNotch} className="doc-spin" aria-hidden="true" /> Saving {uploadingCount} file{uploadingCount === 1 ? '' : 's'}…</>
            ) : (
              <><FontAwesomeIcon icon={faFloppyDisk} aria-hidden="true" /> Save{pendingToSave.length > 1 ? ` (${pendingToSave.length})` : ''}</>
            )}
          </button>
        </div>
      )}

      <div
        className={`doc-dropzone${dragActive ? ' drag-active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <button type="button" className="btn btn-primary doc-upload-btn-lg">Choose Files</button>
        <div className="doc-dropzone-text">Drop files here or click to select</div>
        <div className="doc-dropzone-sub">Any file type — review below, then Save.</div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
