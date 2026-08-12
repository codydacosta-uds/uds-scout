/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSuccessToast, SaveButton } from "@/components/action-ui";

afterEach(() => vi.useRealTimers());

describe("SaveButton", () => {
  it("keeps the shared save action accessible and forwards activation", () => {
    const onClick = vi.fn();
    render(<SaveButton onClick={onClick}>Save workspace</SaveButton>);
    const button = screen.getByRole("button", { name: "Save workspace" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the shared fallback label and honors disabled state", () => {
    render(<SaveButton disabled />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("ActionSuccessToast", () => {
  it("announces a quick action and dismisses itself after the configured duration", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ActionSuccessToast confirmation={{ header: "Job re-run requested", content: "The job was queued." }} duration={1_000} onDismiss={onDismiss} />);

    expect(screen.getByRole("status")).toHaveTextContent("Job re-run requested");
    act(() => vi.advanceTimersByTime(720));
    expect(screen.getByRole("status")).toHaveClass("action-success-toast-exiting");
    act(() => vi.advanceTimersByTime(280));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
