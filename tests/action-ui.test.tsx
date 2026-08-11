/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveButton } from "@/components/action-ui";

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
