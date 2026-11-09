import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '../../app/strings';

interface ToastData {
  message: string;
  onUndo: () => void;
}

const ToastContext = createContext<(message: string, onUndo: () => void) => void>(() => {});

/** A message with an Undo button that disappears after about 5 seconds (FR-4). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: string, onUndo: () => void) => {
    clearTimeout(timer.current);
    setToast({ message, onUndo });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => {
                clearTimeout(timer.current);
                toast.onUndo();
                setToast(null);
              }}
            >
              {t.todo.undo}
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useUndoToast = () => useContext(ToastContext);
