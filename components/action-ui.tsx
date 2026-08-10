"use client";

import Button, { type ButtonProps } from "@cloudscape-design/components/button";
import Flashbar from "@cloudscape-design/components/flashbar";
import type { ReactNode } from "react";

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
