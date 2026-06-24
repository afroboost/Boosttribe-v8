import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

// Toast types
type ToastVariant = "default" | "success" | "error" | "warning";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Generate unique ID
function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Toast Provider
interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "default", duration: number = 4000) => {
    const id = generateId();
    const newToast: Toast = { id, message, variant, duration };
    
    setToasts((current) => [...current, newToast]);

    // Auto dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

// Hook to use toast
export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

// Toast Container Component
interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

// Individual Toast Item
interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const variantStyles: Record<ToastVariant, { bg: string; border: string; Icon: React.ComponentType<{ className?: string }> }> = {
  default: {
    bg: "bg-white/10",
    border: "border-white/20",
    Icon: Info,
  },
  success: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    Icon: CheckCircle2,
  },
  error: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    Icon: XCircle,
  },
  warning: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    Icon: AlertTriangle,
  },
};

const variantTextColors: Record<ToastVariant, string> = {
  default: "text-white",
  success: "text-green-400",
  error: "text-red-400",
  warning: "text-yellow-400",
};

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const styles = variantStyles[toast.variant];
  const textColor = variantTextColors[toast.variant];
  const Icon = styles.Icon;

  return (
    <div
      className={`
        ${styles.bg} ${styles.border} ${textColor}
        border rounded-lg p-4 pr-10 shadow-lg backdrop-blur-xl
        animate-in slide-in-from-right-full duration-300
        relative
      `}
      style={{ fontFamily: "var(--bt-font-body)" }}
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p className="text-sm">{toast.message}</p>
      </div>

      <button
        onClick={() => onDismiss(toast.id)}
        className="absolute top-2 right-2 p-1 text-white/50 hover:text-white transition-colors"
        aria-label="Fermer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default ToastProvider;
