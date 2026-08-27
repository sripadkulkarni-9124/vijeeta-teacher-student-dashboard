import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.closest("[hidden], [aria-hidden='true']") === null,
  );
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

interface ModalProps extends DialogProps {
  variant: "dialog" | "drawer";
}

function Modal({ children, onClose, open, title, variant }: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = `vjt-${variant}-${useId()}`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    priorFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const container = containerRef.current;
    if (!container) return;

    const focusFirst = () => {
      const [first] = getFocusable(container);
      (first ?? container).focus();
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) {
        focusFirst();
      }
    };
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };

    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", handleDocumentKeyDown);
    focusFirst();

    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", handleDocumentKeyDown);
      priorFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;

    const focusable = containerRef.current
      ? getFocusable(containerRef.current)
      : [];
    if (focusable.length === 0) {
      event.preventDefault();
      containerRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="vjt-modal-layer">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`vjt-${variant}`}
        onKeyDown={handleKeyDown}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Dialog(props: DialogProps) {
  return <Modal {...props} variant="dialog" />;
}

export function Drawer(props: DialogProps) {
  return <Modal {...props} variant="drawer" />;
}
