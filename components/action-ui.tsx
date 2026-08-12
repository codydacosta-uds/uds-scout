"use client";

import Button, { type ButtonProps } from "@cloudscape-design/components/button";
import Flashbar from "@cloudscape-design/components/flashbar";
import Icon from "@cloudscape-design/components/icon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const primaryActionStyle = {
  root: {
    background: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    borderColor: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    color: { default: "#0b0c0e", hover: "#0b0c0e", active: "#0b0c0e" },
  },
} as const;

export type ActionConfirmation = {
  header: string;
  content?: ReactNode;
};

/** Shared primary action treatment for saves, confirmations, and workflow execution. */
export function PrimaryActionButton(props: ButtonProps) {
  return <Button {...props} variant="primary" style={primaryActionStyle} />;
}

/** Shared save action. Successful handlers should display ActionSuccessFlashbar. */
export function SaveButton({ children, ...props }: ButtonProps) {
  return <PrimaryActionButton {...props}>{children ?? "Save changes"}</PrimaryActionButton>;
}

/** Standard acknowledgement shown after a user-initiated action succeeds. */
export function ActionSuccessFlashbar({ confirmation, onDismiss }: {
  confirmation: ActionConfirmation;
  onDismiss: () => void;
}) {
  return <Flashbar items={[{
    type: "success",
    header: confirmation.header,
    content: confirmation.content,
    dismissible: true,
    onDismiss,
  }]} />;
}

/** Temporary acknowledgement for quick actions that should not move surrounding content. */
export function ActionSuccessToast({ confirmation, onDismiss, duration = 5_000 }: {
  confirmation: ActionConfirmation;
  onDismiss: () => void;
  duration?: number;
}) {
  const [exiting, setExiting] = useState(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timer = window.setTimeout(() => setExiting(true), Math.max(0, duration - 280));
    return () => window.clearTimeout(timer);
  }, [confirmation, duration]);

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => onDismissRef.current(), 280);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`action-success-toast${exiting ? " action-success-toast-exiting" : ""}`} role="status" aria-live="polite">
      <div className="action-success-toast-icon"><Icon name="status-positive" /></div>
      <div className="action-success-toast-copy">
        <div className="action-success-toast-header">{confirmation.header}</div>
        {confirmation.content ? <div className="action-success-toast-content">{confirmation.content}</div> : null}
      </div>
      <Button variant="icon" iconName="close" ariaLabel="Dismiss notification" onClick={() => setExiting(true)} />
    </div>,
    document.body,
  );
}
