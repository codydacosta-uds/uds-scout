"use client";

import Link from "@cloudscape-design/components/link";
import Popover from "@cloudscape-design/components/popover";

export function InfoPopover({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <Popover header={header} content={children} dismissButton dismissAriaLabel="Close information" position="right" size="medium" triggerType="custom">
      <Link variant="info" ariaLabel={`About ${header}`}>Info</Link>
    </Popover>
  );
}
