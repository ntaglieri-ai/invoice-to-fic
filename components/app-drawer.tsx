"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function AppDrawer({ title, onClose, children, footer, busy = false, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; busy?: boolean; wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={dialog} aria-labelledby={id} className={`app-drawer ${wide ? "drawer-wide" : ""}`} onCancel={(event) => { event.preventDefault(); }}>
    <header className="drawer-header"><div><span className="drawer-eyebrow">GESTIONE ACQUISTI</span><h2 id={id}>{title}</h2></div><button className="sf-icon" type="button" title="Chiudi" aria-label={`Chiudi ${title}`} disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className="drawer-content">{children}</div>
    {footer && <footer className="drawer-footer">{footer}</footer>}
  </dialog>;
}
