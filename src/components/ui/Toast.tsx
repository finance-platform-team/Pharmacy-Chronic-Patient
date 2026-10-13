import './Toast.css';

export interface ToastMessage {
  message: string;
  tone: 'success' | 'error';
}

export function Toast({ message, tone }: ToastMessage) {
  return (
    <div className={`ui-toast ui-toast-${tone}`} role="status">
      <span className="ui-toast-icon">{tone === 'success' ? '✓' : '!'}</span>
      <span className="ui-toast-message">{message}</span>
    </div>
  );
}
