import { useEffect, useState } from 'react';

export interface ToastMessage {
  text: string;
  tone: 'success' | 'error';
}

/** Every action needs clear success/failure feedback (UI_DESIGN.md §7). */
export function Toast({ message, onDismiss }: { message: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    // assertive for errors so a screen reader interrupts; polite for routine success.
    <div
      className={`toast toast--${message.tone}`}
      role={message.tone === 'error' ? 'alert' : 'status'}
      aria-live={message.tone === 'error' ? 'assertive' : 'polite'}
    >
      {message.text}
    </div>
  );
}

export function useToast() {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  return {
    message,
    dismiss: () => setMessage(null),
    success: (text: string) => setMessage({ text, tone: 'success' }),
    error: (text: string) => setMessage({ text, tone: 'error' }),
  };
}
