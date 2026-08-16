import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Minimal accessible dialog: labelled, Escape-dismissable, and focus moves into it on
 * open so keyboard users aren't left behind the backdrop (UI_DESIGN.md §5).
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    // Focus the first field so typing works immediately without a mouse.
    const firstField = dialogRef.current?.querySelector<HTMLElement>('input, select, textarea, button');
    firstField?.focus();

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="btn btn--sm" onClick={onClose}>
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Close dialog</span>
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
