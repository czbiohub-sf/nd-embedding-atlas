export interface ToastProps {
  title: string;
  description?: string;
  /** default has no dot; success/error/warning add a status dot. */
  tone?: 'default' | 'success' | 'error' | 'warning';
  onClose?: () => void;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;
export interface ToastData extends ToastProps { id: string | number }
export interface ToasterProps { toasts: ToastData[]; onDismiss?: (id: string | number) => void; style?: React.CSSProperties }
export declare function Toaster(props: ToasterProps): JSX.Element;
