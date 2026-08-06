"use client";

import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useEffect, useState } from "react";
import type { ZeusHealth } from "./types";

let cachedHealth: ZeusHealth | null = null;

function formatCapacity(bytes: number) {
  const gibibytes = bytes / 1024 ** 3;
  if (gibibytes >= 1024) return `${(gibibytes / 1024).toFixed(1)} TiB`;
  return `${gibibytes.toFixed(gibibytes >= 100 ? 0 : 1)} GiB`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function usageColor(value: number) {
  return value >= 97 ? "#f85149" : value >= 85 ? "#d6a514" : "#2ea043";
}

function ResourceUsage({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <ProgressBar
      value={value}
      label={label}
      description={detail}
      ariaLabel={`${label} ${value.toFixed(1)} percent used`}
      style={{ progressValue: { backgroundColor: usageColor(value) } }}
    />
  );
}

function TemporaryStorageUsage({ usedBytes }: { usedBytes: number | null }) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="strong">/tmp</Box>
      <Box variant="awsui-value-large">{usedBytes === null ? "Unavailable" : formatCapacity(usedBytes)}</Box>
      <Box color="text-body-secondary">Temporary files currently stored</Box>
    </SpaceBetween>
  );
}

export function ZeusHealthCard({ refreshKey }: { refreshKey: number }) {
  const [health, setHealth] = useState<ZeusHealth | null>(() => cachedHealth);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cachedHealth);
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    let lastPoll = Date.now();
    const pollIfVisibleAndDue = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastPoll < 60_000) return;
      lastPoll = Date.now();
      setPollKey((value) => value + 1);
    };
    const timer = window.setInterval(pollIfVisibleAndDue, 60_000);
    document.addEventListener("visibilitychange", pollIfVisibleAndDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pollIfVisibleAndDue);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/zeus/status?refresh=${refreshKey}-${pollKey}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Zeus host status could not be loaded.");
        return data as ZeusHealth;
      })
      .then((data) => {
        cachedHealth = data;
        setError(null);
        setHealth(data);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [pollKey, refreshKey]);

  if (!health) {
    return (
      <Container header={<Header variant="h2">Host resources</Header>}>
        {loading
          ? <SpaceBetween direction="horizontal" size="s"><Spinner /><Box color="text-body-secondary">Reading CPU, memory, and disk usage…</Box></SpaceBetween>
          : <StatusIndicator type="error">Host resource data is unavailable{error ? ". Confirm Zeus is reachable." : "."}</StatusIndicator>}
      </Container>
    );
  }

  const filesystemPeak = Math.max(...health.filesystems.map((filesystem) => filesystem.usagePercent));
  const peak = Math.max(health.cpuUsagePercent, health.memory.usagePercent, filesystemPeak);
  const status = error
    ? <StatusIndicator type="warning">Latest reading is unavailable</StatusIndicator>
    : peak >= 97
      ? <StatusIndicator type="error">Resource pressure requires attention</StatusIndicator>
      : peak >= 85
        ? <StatusIndicator type="warning">Resource usage needs attention</StatusIndicator>
        : <StatusIndicator type="success">Resources are healthy</StatusIndicator>;
  const resources = [
    <ResourceUsage key="cpu" label="CPU" value={health.cpuUsagePercent} detail={`${health.cpuCount} CPUs · load ${health.loadAverage.join(" / ")}`} />,
    <ResourceUsage key="memory" label="Memory" value={health.memory.usagePercent} detail={`${formatCapacity(health.memory.usedBytes)} of ${formatCapacity(health.memory.totalBytes)} used`} />,
    ...health.filesystems.map((filesystem) => <ResourceUsage key={`${filesystem.path}-${filesystem.label}`} label={filesystem.label} value={filesystem.usagePercent} detail={`${formatCapacity(filesystem.usedBytes)} of ${formatCapacity(filesystem.totalBytes)} used · ${filesystem.path}`} />),
    <TemporaryStorageUsage key="temporary-storage" usedBytes={health.temporaryStorage.usedBytes} />,
  ];

  return (
    <Container header={<Header variant="h2" description={`${health.hostname} · up ${formatUptime(health.uptimeSeconds)} · sampled ${new Date(health.capturedAt).toLocaleTimeString()}`} actions={status}>Host resources</Header>}>
      <Grid gridDefinition={resources.map(() => ({ colspan: { default: 12, xs: 6, l: 4 } }))}>{resources}</Grid>
    </Container>
  );
}
