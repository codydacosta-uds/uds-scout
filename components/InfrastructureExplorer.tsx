"use client";

import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Drawer from "@cloudscape-design/components/drawer";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { DrawerPrimaryButton } from "./operations-ui";
import type {
  InfrastructureCategory,
  InfrastructureExplorerData,
  InfrastructureNode,
} from "./infrastructure-types";

type GraphData = {
  label: React.ReactNode;
  infrastructure?: InfrastructureNode;
  system?: string;
};

const CATEGORY_COLORS: Record<InfrastructureCategory, string> = {
  Networking: "#9da3ab",
  Compute: "#7f858d",
  Kubernetes: "#b0b5bc",
  Storage: "#8b9199",
  Databases: "#6f757d",
  Identity: "#a6abb2",
  Security: "#858b93",
  Monitoring: "#b8bdc4",
  Integration: "#747a82",
  Platform: "#969ca4",
};

function human(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function layoutGraph(nodes: FlowNode<GraphData>[], edges: FlowEdge[]) {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 90, nodesep: 28, marginx: 32, marginy: 32 });
  nodes.forEach((node) => graph.setNode(node.id, { width: 230, height: 82 }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const position = graph.node(node.id);
    return { ...node, position: { x: position.x - 115, y: position.y - 41 } };
  });
}

function graphNodeLabel(node: InfrastructureNode) {
  return (
    <div className="infrastructure-node-content">
      <div className="infrastructure-node-heading">
        <span className="infrastructure-node-dot" style={{ backgroundColor: CATEGORY_COLORS[node.category] }} />
        <span>{human(node.name)}</span>
      </div>
      <div className="infrastructure-node-meta">{node.system} · {node.kind === "data" ? "Existing reference" : human(node.type)}</div>
    </div>
  );
}

function componentGraph(data: InfrastructureExplorerData, items: InfrastructureNode[], focusedSystem: string) {
  const visible = items.slice(0, 80);
  const ids = new Set(visible.map((node) => node.id));
  const nodes: FlowNode<GraphData>[] = visible.map((node) => ({
    id: node.id,
    position: { x: 0, y: 0 },
    data: { infrastructure: node, label: graphNodeLabel(node) },
    className: `infrastructure-graph-node ${node.managed ? "managed" : "referenced"} ${focusedSystem !== "all" && node.system !== focusedSystem ? "context" : ""}`,
    style: { borderColor: CATEGORY_COLORS[node.category] },
  }));
  const edges: FlowEdge[] = data.edges
    .filter((edge) => edge.relationship === "depends-on" && ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6e7681" },
      style: { stroke: "#6e7681", strokeWidth: 1.2 },
    }));
  return { nodes: layoutGraph(nodes, edges), edges, truncated: items.length > visible.length };
}

function systemGraph(data: InfrastructureExplorerData) {
  const systemNames = new Set(data.systems.map((system) => system.name));
  const nodeSystem = new Map(data.nodes.map((node) => [node.id, node.system]));
  const pairs = new Map<string, number>();
  data.edges.forEach((edge) => {
    if (edge.relationship !== "depends-on") return;
    const source = nodeSystem.get(edge.source);
    const target = nodeSystem.get(edge.target);
    if (!source || !target || source === target || !systemNames.has(source) || !systemNames.has(target)) return;
    const key = `${source}|||${target}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  });
  const nodes: FlowNode<GraphData>[] = data.systems.map((system) => ({
    id: `system:${system.name}`,
    position: { x: 0, y: 0 },
    data: {
      system: system.name,
      label: <div className="infrastructure-node-content">
        <div className="infrastructure-node-heading">{system.name}</div>
        <div className="infrastructure-node-meta">{system.count} components</div>
      </div>,
    },
    className: "infrastructure-graph-node infrastructure-system-node",
  }));
  const strongestConnections = [...pairs.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28);
  const edges: FlowEdge[] = strongestConnections.map(([key, count]) => {
    const [source, target] = key.split("|||");
    return {
      id: `system:${key}`,
      source: `system:${source}`,
      target: `system:${target}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6e7681" },
      style: { stroke: "#6e7681", strokeWidth: Math.min(3, 1 + count / 8) },
      labelStyle: { fill: "#8b949e", fontSize: 11 },
    };
  });
  const gridNodes = nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % 5) * 275,
      y: Math.floor(index / 5) * 125,
    },
  }));
  return { nodes: gridNodes, edges };
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Container>
      <SpaceBetween size="xs">
        <Box variant="awsui-key-label">{label}</Box>
        <Box variant="awsui-value-large">{value}</Box>
        <Box color="text-body-secondary">{detail}</Box>
      </SpaceBetween>
    </Container>
  );
}

export function InfrastructureExplorer({
  data,
  onSelect,
}: {
  data: InfrastructureExplorerData;
  onSelect: (node: InfrastructureNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [system, setSystem] = useState("all");
  const [ownership, setOwnership] = useState("root");
  const [graphMode, setGraphMode] = useState("systems");
  const [exporting, setExporting] = useState(false);
  const [markdownCopied, setMarkdownCopied] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);

  const categoryOptions = [
    { label: "All categories", value: "all" },
    ...data.categories.map((item) => ({ label: `${item.name} (${item.count})`, value: item.name })),
  ];
  const systemOptions = [
    { label: "All systems", value: "all" },
    ...data.systems.map((item) => ({ label: `${item.name} (${item.count})`, value: item.name })),
  ];
  const ownershipOptions = [
    { label: "Top-level deployed stack", value: "root" },
    { label: "Created by this repository", value: "managed" },
    { label: "Existing infrastructure references", value: "referenced" },
    { label: "Reusable module internals", value: "definitions" },
    { label: "Everything analyzed", value: "all" },
  ];

  const filtered = useMemo(() => {
    const search = query.toLowerCase().trim();
    return data.nodes.filter((node) =>
      (category === "all" || node.category === category) &&
      (system === "all" || node.system === system) &&
      (ownership === "all" ||
        (ownership === "root" && node.scope === "root") ||
        (ownership === "managed" && node.scope === "root" && node.managed) ||
        (ownership === "referenced" && node.scope === "root" && !node.managed) ||
        (ownership === "definitions" && node.scope !== "root")) &&
      (!search || [node.name, node.address, node.type, node.system, node.summary, node.file].some((value) => value.toLowerCase().includes(search))),
    );
  }, [category, data.nodes, ownership, query, system]);

  const graphItems = useMemo(() => {
    if (system === "all") return filtered;
    const selectedIds = new Set(filtered.map((node) => node.id));
    const connectedIds = new Set<string>();
    filtered.forEach((node) => {
      node.dependencies.forEach((id) => connectedIds.add(id));
      node.dependents.forEach((id) => connectedIds.add(id));
    });
    return data.nodes.filter((node) => selectedIds.has(node.id) || (node.scope === "root" && connectedIds.has(node.id)));
  }, [data.nodes, filtered, system]);

  const focusedSystem = useMemo(() => {
    if (system === "all") return null;
    const own = data.nodes.filter((node) => node.scope === "root" && node.system === system);
    const ownIds = new Set(own.map((node) => node.id));
    const upstream = new Set(own.flatMap((node) => node.dependencies).filter((id) => !ownIds.has(id)));
    const downstream = new Set(own.flatMap((node) => node.dependents).filter((id) => !ownIds.has(id)));
    return {
      nodes: own.length,
      managed: own.filter((node) => node.managed).length,
      referenced: own.filter((node) => !node.managed).length,
      upstream: upstream.size,
      downstream: downstream.size,
    };
  }, [data.nodes, system]);

  const graph = useMemo(
    () => graphMode === "systems" ? systemGraph(data) : componentGraph(data, graphItems, system),
    [data, graphItems, graphMode, system],
  );

  const rootVariables = data.variables.filter((variable) => !variable.name.startsWith("module."));

  const markdownForGraph = () => {
    const rows = graph.nodes.flatMap((node) => node.data.infrastructure ? [node.data.infrastructure] : []);
    const lines = [
      `*${system === "all" ? "SWF infrastructure" : `${system} infrastructure`} dependencies*`,
      `_${graphMode === "systems" ? "System overview" : "Component dependencies"} · ${rows.length} resources · ${graph.edges.length} relationships_`,
      "",
      "```",
      "Resource                              Kind          Ownership",
      "------------------------------------  ------------  ------------------",
      ...rows.map((node) => `${node.name.padEnd(36).slice(0, 36)}  ${node.kind.padEnd(12)}  ${node.managed ? "Managed" : "Existing reference"}`),
      "```",
      "",
      "*Source links*",
      ...rows.map((node) => `• <${node.sourceUrl}|${node.file}:${node.line}>`),
    ];
    return lines.join("\n");
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownForGraph());
      setMarkdownCopied(true);
      window.setTimeout(() => setMarkdownCopied(false), 2500);
    } catch (error) {
      console.error("Infrastructure Markdown copy failed", error);
    }
  };

  const downloadMarkdown = () => {
    const link = document.createElement("a");
    link.download = `uds-scout-${graphMode === "systems" ? "systems" : `${system}-dependencies`}.md`;
    link.href = URL.createObjectURL(new Blob([markdownForGraph()], { type: "text/markdown;charset=utf-8" }));
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportGraph = async () => {
    if (!graphRef.current) return;
    setExporting(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const dataUrl = await toPng(graphRef.current, { backgroundColor: "#0b0c0e", pixelRatio: 2, cacheBust: true, filter: (node) => {
        const element = node as HTMLElement;
        return !element.classList?.contains("react-flow__controls") && !element.classList?.contains("react-flow__attribution");
      } });
      const link = document.createElement("a");
      link.download = `uds-scout-${graphMode === "systems" ? "systems" : `${system}-dependencies`}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("Infrastructure graph export failed", error);
    } finally {
      setExporting(false);
    }
  };
  const rootOutputs = data.outputs.filter((output) => !output.name.startsWith("module."));

  const filters = (
    <div className="infrastructure-filters">
      <TextFilter
        filteringText={query}
        onChange={({ detail }) => setQuery(detail.filteringText)}
        filteringPlaceholder="Search components, systems, types, or files"
        countText={`${filtered.length} matches`}
      />
      <Select selectedOption={categoryOptions.find((option) => option.value === category) ?? null} onChange={({ detail }) => setCategory(detail.selectedOption.value ?? "all")} options={categoryOptions} />
      <Select selectedOption={systemOptions.find((option) => option.value === system) ?? null} onChange={({ detail }) => setSystem(detail.selectedOption.value ?? "all")} options={systemOptions} />
      <Select selectedOption={ownershipOptions.find((option) => option.value === ownership) ?? null} onChange={({ detail }) => setOwnership(detail.selectedOption.value ?? "all")} options={ownershipOptions} />
    </div>
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Explore what the SWF Terraform stack deploys, references, and connects without reading the configuration."
          actions={<SpaceBetween direction="horizontal" size="xs"><Button className="infrastructure-export-button" iconName="download" loading={exporting} onClick={() => void exportGraph()}>Export image</Button><Button className="infrastructure-export-button" iconName="copy" onClick={() => void copyMarkdown()}>{markdownCopied ? "Copied" : "Copy for Slack"}</Button><Button className="infrastructure-export-button" iconName="download" onClick={downloadMarkdown}>Download Markdown</Button><Button href={data.sourceUrl} external>Open Terraform source</Button></SpaceBetween>}
        >
          Infrastructure Explorer
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">SWF architecture at a glance</Header>}>
          <Box fontSize="body-m">{data.summary}</Box>
        </Container>

        <Grid gridDefinition={[
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
        ]}>
          <Metric label="Managed components" value={data.metrics.managed} detail="Created or managed by this stack." />
          <Metric label="Existing references" value={data.metrics.referenced} detail="Read from the AWS account or environment." />
          <Metric label="Relationships" value={data.metrics.relationships} detail="Automatically inferred dependencies." />
          <Metric label="Logical systems" value={data.metrics.systems} detail={`Across ${data.metrics.files} Terraform files.`} />
        </Grid>

        <Tabs
          tabs={[
            {
              label: "Architecture",
              id: "architecture",
              content: (
                <SpaceBetween size="l">
                  <ColumnLayout columns={2} variant="text-grid">
                    <Container header={<Header variant="h2">Infrastructure categories</Header>}>
                      <SpaceBetween size="s">
                        {data.categories.map((item) => (
                          <div className="infrastructure-category-row" key={item.name}>
                            <span><span className="infrastructure-category-dot" style={{ backgroundColor: CATEGORY_COLORS[item.name] }} />{item.name}</span>
                            <span>{item.managed} created · {item.referenced} referenced</span>
                          </div>
                        ))}
                      </SpaceBetween>
                    </Container>
                    <Container header={<Header variant="h2">Environments and ownership</Header>}>
                      <KeyValuePairs items={[
                        { label: "Environments", value: <SpaceBetween direction="horizontal" size="xs">{data.deployment.environments.map((environment) => <Badge color={environment.status === "deployed" ? "blue" : "grey"} key={environment.name}>{environment.name}{environment.status === "vestigial" ? " · vestigial" : ""}</Badge>)}</SpaceBetween> },
                        { label: "Repository", value: <Link href={data.sourceUrl} external>{data.repository}</Link> },
                        { label: "Terraform root", value: <Box variant="code">{data.rootPath}</Box> },
                        { label: "Reusable modules", value: `${data.metrics.modules} module calls` },
                      ]} />
                    </Container>
                  </ColumnLayout>

                  <Container
                    header={<Header variant="h2" description={graphMode === "systems" ? "Select a system to focus the component view." : "Arrows point from a component to infrastructure it relies on."}>Dependency map</Header>}
                  >
                    <SpaceBetween size="m">
                      <div className="infrastructure-graph-toolbar">
                        <Select
                          selectedOption={graphMode === "systems" ? { label: "System overview", value: "systems" } : { label: "Component dependencies", value: "components" }}
                          onChange={({ detail }) => setGraphMode(detail.selectedOption.value ?? "systems")}
                          options={[{ label: "System overview", value: "systems" }, { label: "Component dependencies", value: "components" }]}
                        />
                        {graphMode === "components" ? filters : <Box color="text-body-secondary">Click a system to filter its components.</Box>}
                        <Button variant="icon" iconName="download" loading={exporting} ariaLabel="Export image" onClick={() => void exportGraph()} /><Button variant="icon" iconName="copy" ariaLabel={markdownCopied ? "Markdown copied" : "Copy for Slack"} onClick={() => void copyMarkdown()} /><Button variant="icon" iconName="download" ariaLabel="Download Markdown" onClick={downloadMarkdown} />
                      </div>
                      {graphMode === "components" && focusedSystem ? (
                        <Container header={<Header variant="h3">{system} infrastructure</Header>}>
                          <SpaceBetween size="m">
                            <Box color="text-body-secondary">This focused view includes the components defined for {system} plus directly connected shared infrastructure. Faded nodes belong to another system but are shown because {system} relies on them or they rely on {system}.</Box>
                            <KeyValuePairs columns={4} items={[
                              { label: "Created here", value: focusedSystem.managed },
                              { label: "Existing references", value: focusedSystem.referenced },
                              { label: "Shared dependencies", value: focusedSystem.upstream },
                              { label: "Used by other components", value: focusedSystem.downstream },
                            ]} />
                          </SpaceBetween>
                        </Container>
                      ) : null}
                      {graphMode === "components" && "truncated" in graph && graph.truncated ? <StatusIndicator type="info">Showing the first 80 matches. Narrow the category, system, or search filter to see a focused graph.</StatusIndicator> : null}
                      <div ref={graphRef} className={`infrastructure-graph${exporting ? " infrastructure-graph-exporting" : ""}`} aria-label="Infrastructure dependency graph">
                        <div className="infrastructure-graph-export-header"><strong>{system === "all" ? "SWF infrastructure dependency map" : `${system} infrastructure dependencies`}</strong><span>{graphMode === "systems" ? "System overview" : "Component dependencies"} · {graph.nodes.length} nodes · {graph.edges.length} relationships</span></div>
                        <ReactFlow
                          key={`${graphMode}:${system}:${category}:${ownership}:${query}`}
                          nodes={graph.nodes}
                          edges={graph.edges}
                          fitView
                          fitViewOptions={{ padding: 0.18 }}
                          minZoom={0.2}
                          maxZoom={1.5}
                          nodesDraggable={false}
                          nodesConnectable={false}
                          elementsSelectable
                          onNodeClick={(_, node) => {
                            if (node.data.infrastructure) onSelect(node.data.infrastructure);
                            else if (node.data.system) {
                              setQuery("");
                              setCategory("all");
                              setOwnership("root");
                              setSystem(node.data.system);
                              setGraphMode("components");
                            }
                          }}
                        >
                          <Background color="#34383e" gap={24} size={1} />
                          <Controls showInteractive={false} />
                        </ReactFlow>
                      </div>
                    </SpaceBetween>
                  </Container>
                </SpaceBetween>
              ),
            },
            {
              label: "Deployment",
              id: "deployment",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2">How this platform is deployed</Header>}>
                    <SpaceBetween size="m">
                      <Box fontSize="body-m">{data.deployment.summary}</Box>
                      <Box color="text-body-secondary">{data.deployment.preferredInterface}</Box>
                      <KeyValuePairs columns={2} items={[
                        { label: "Supported interface", value: <Badge color="blue">UDS tasks</Badge> },
                        { label: "Convenience workflow", value: <Box variant="code">{data.deployment.quickCommand}</Box> },
                      ]} />
                    </SpaceBetween>
                  </Container>

                  <Container header={<Header variant="h2" description="Only staging and production are active SONIC deployment targets.">Deployment environments</Header>}>
                    <ColumnLayout columns={3} variant="text-grid">
                      {data.deployment.environments.map((environment) => (
                        <SpaceBetween size="xs" key={environment.name}>
                          <Box variant="h3">{environment.name} <Badge color={environment.status === "deployed" ? "blue" : "grey"}>{environment.status}</Badge></Box>
                          <Box color="text-body-secondary">{environment.purpose}</Box>
                          <Button href={environment.tfvarsUrl} external variant="inline-link">View environment configuration</Button>
                        </SpaceBetween>
                      ))}
                    </ColumnLayout>
                  </Container>

                  <Container header={<Header variant="h2" description="The roots build on one another. SWF is the third root, not the complete repository deployment.">Terraform root order</Header>}>
                    <div className="deployment-root-sequence">
                      {data.deployment.roots.map((root) => (
                        <div className="deployment-root-card" key={root.name}>
                          <Box color="text-body-secondary">Step {root.order}</Box>
                          <Box variant="h3">{root.name}</Box>
                          <Box color="text-body-secondary">{root.purpose}</Box>
                          <Box variant="code">{root.command}</Box>
                          <Button href={root.sourceUrl} external variant="inline-link">Open {root.path}</Button>
                        </div>
                      ))}
                    </div>
                  </Container>

                  <Container header={<Header variant="h2" counter={`(${data.deployment.steps.length})`} description="This sequence separates first-time setup from the repeatable deployment path.">Operator journey</Header>}>
                    <div className="deployment-journey">
                      {data.deployment.steps.map((step) => (
                        <div className="deployment-step" key={step.id}>
                          <div className="deployment-step-number">{step.order}</div>
                          <SpaceBetween size="s">
                            <div className="deployment-step-heading">
                              <Box variant="h3">{step.title}</Box>
                              <SpaceBetween direction="horizontal" size="xs"><Badge color="blue">{step.phase}</Badge><Badge color="grey">{step.frequency}</Badge></SpaceBetween>
                            </div>
                            <Box>{step.description}</Box>
                            <Box variant="code">{step.command}</Box>
                            <Box color="text-body-secondary"><Box variant="strong" display="inline">Outcome: </Box>{step.outcome}</Box>
                            <Button href={step.source.url} external variant="inline-link">View task source · {step.source.file}:{step.source.line}</Button>
                          </SpaceBetween>
                        </div>
                      ))}
                    </div>
                  </Container>

                  <Container header={<Header variant="h2">Source-of-truth notes</Header>}>
                    <SpaceBetween size="m">
                      {data.deployment.notices.map((notice, index) => (
                        <div className="deployment-notice" key={`${notice.type}-${index}`}>
                          <StatusIndicator type={notice.type === "warning" ? "warning" : "info"}>{notice.message}</StatusIndicator>
                          {notice.source ? <Button href={notice.source.url} external variant="inline-link">View source</Button> : null}
                        </div>
                      ))}
                    </SpaceBetween>
                  </Container>
                </SpaceBetween>
              ),
            },
            {
              label: "UDS configuration",
              id: "uds-configuration",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2" description="Terraform does not deploy the applications directly. It prepares the environment-specific values consumed by the UDS bundle.">How infrastructure reaches UDS</Header>}>
                    <SpaceBetween size="m">
                      <StatusIndicator type="info">Secret values are intentionally never returned by this explorer.</StatusIndicator>
                      <div className="uds-config-flow">
                        {data.deployment.udsConfigFlow.map((item, index) => (
                          <div className="uds-config-flow-card" key={item.title}>
                            <div className="uds-config-flow-number">{index + 1}</div>
                            <Box variant="h3">{item.title}</Box>
                            <Box color="text-body-secondary">{item.description}</Box>
                            <Button href={item.source.url} external variant="inline-link">View source</Button>
                          </div>
                        ))}
                      </div>
                    </SpaceBetween>
                  </Container>

                  <Grid gridDefinition={[
                    { colspan: { default: 12, xs: 4 } },
                    { colspan: { default: 12, xs: 4 } },
                    { colspan: { default: 12, xs: 4 } },
                  ]}>
                    <Metric label="Bundle packages" value={data.deployment.packages.length} detail="Installed in declared bundle order." />
                    <Metric label="Configuration sections" value={data.deployment.configSections.length} detail="Package-specific groups generated by Terraform." />
                    <Metric label="Infrastructure bindings" value={new Set(data.deployment.configSections.flatMap((section) => section.infrastructureNodeIds)).size} detail="Managed components feeding UDS configuration." />
                  </Grid>

                  <Table
                    variant="container"
                    stickyHeader
                    trackBy="name"
                    items={data.deployment.configSections}
                    header={<Header variant="h2" counter={`(${data.deployment.configSections.length})`} description="Each section connects Terraform-managed infrastructure to one or more UDS packages without exposing its values.">UDS configuration sections</Header>}
                    columnDefinitions={[
                      { id: "section", header: "Configuration section", cell: (item) => <SpaceBetween size="xxs"><Box variant="strong">{item.name}</Box><Box color="text-body-secondary">{item.variableCount} settings</Box></SpaceBetween> },
                      { id: "purpose", header: "Examples of values supplied", cell: (item) => item.variables.length ? `${item.variables.slice(0, 4).join(", ")}${item.variables.length > 4 ? `, +${item.variables.length - 4} more` : ""}` : "No top-level variables detected" },
                      { id: "consumer", header: "Bundle consumer", cell: (item) => { const consumers = data.deployment.packages.filter((candidate) => candidate.configSections.includes(item.name)); return consumers.length ? consumers.map((consumer) => consumer.name).join(", ") : <StatusIndicator type="warning">No active package match</StatusIndicator>; } },
                      { id: "infrastructure", header: "Infrastructure inputs", cell: (item) => item.infrastructureNodeIds.length ? <SpaceBetween size="xxs">{item.infrastructureNodeIds.slice(0, 3).map((id) => { const node = data.nodes.find((candidate) => candidate.id === id); return node ? <Button key={id} variant="inline-link" onClick={() => onSelect(node)}>{human(node.name)}</Button> : null; })}{item.infrastructureNodeIds.length > 3 ? <Box color="text-body-secondary">+{item.infrastructureNodeIds.length - 3} more connections</Box> : null}</SpaceBetween> : <Box color="text-body-secondary">Static or environment-provided values</Box> },
                      { id: "source", header: "Generated in", cell: (item) => <Link href={item.source.url} external>{item.source.file}:{item.source.line}</Link> },
                    ]}
                  />

                  <Table
                    variant="container"
                    stickyHeader
                    trackBy="name"
                    items={data.deployment.packages}
                    header={<Header variant="h2" counter={`(${data.deployment.packages.length})`} description="The SWF bundle installs UDS Core, cluster services, and software factory applications in this declared order.">UDS bundle packages</Header>}
                    columnDefinitions={[
                      { id: "order", header: "Order", cell: (item) => item.order },
                      { id: "package", header: "Package", cell: (item) => <SpaceBetween size="xxs"><Link href={item.source.url} external>{item.name}</Link><Box color="text-body-secondary">{item.local ? "Built from this repository" : item.repository ?? "Package source inherited"}</Box></SpaceBetween> },
                      { id: "version", header: "Version", cell: (item) => <Box variant="code">{item.version ?? "Not pinned"}</Box> },
                      { id: "configuration", header: "UDS configuration", cell: (item) => item.configSections.length ? item.configSections.join(", ") : <Box color="text-body-secondary">No dedicated generated section detected</Box> },
                      { id: "components", header: "Optional components", cell: (item) => item.optionalComponents.length ? item.optionalComponents.join(", ") : "None selected" },
                    ]}
                  />
                </SpaceBetween>
              ),
            },
            {
              label: "Inventory",
              id: "inventory",
              content: (
                <Table
                  variant="container"
                  stickyHeader
                  trackBy="id"
                  items={filtered}
                  filter={filters}
                  header={<Header variant="h2" counter={`(${filtered.length})`} description="Top-level components are shown by default. Use the ownership filter to inspect internals of reusable local modules.">Infrastructure inventory</Header>}
                  columnDefinitions={[
                    { id: "component", header: "Component", cell: (item) => <SpaceBetween size="xxs"><Link onFollow={() => onSelect(item)}>{human(item.name)}</Link><Box color="text-body-secondary">{item.address}</Box></SpaceBetween> },
                    { id: "ownership", header: "Ownership", cell: (item) => item.scope !== "root" ? <StatusIndicator type="pending">Reusable definition</StatusIndicator> : item.managed ? <StatusIndicator type="success">Created here</StatusIndicator> : <StatusIndicator type="info">Existing reference</StatusIndicator> },
                    { id: "category", header: "Category", cell: (item) => <span><span className="infrastructure-category-dot" style={{ backgroundColor: CATEGORY_COLORS[item.category] }} />{item.category}</span> },
                    { id: "system", header: "System", cell: (item) => item.system },
                    { id: "dependencies", header: "Connections", cell: (item) => `${item.dependencies.length} upstream · ${item.dependents.length} downstream` },
                    { id: "defined", header: "Defined in", cell: (item) => <Link href={item.sourceUrl} external>{item.file}:{item.line}</Link> },
                  ]}
                  empty={<Box textAlign="center" padding={{ vertical: "xxl" }}>No infrastructure matches the current filters.</Box>}
                />
              ),
            },
            {
              label: "Reusable patterns",
              id: "patterns",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2" description="Repeated architecture choices inferred from module and resource usage.">Patterns in this stack</Header>}>
                    <ColumnLayout columns={2} variant="text-grid">
                      {data.patterns.map((pattern) => (
                        <SpaceBetween size="xs" key={pattern.name}>
                          <Box variant="h3">{pattern.name} ({pattern.count})</Box>
                          <Box color="text-body-secondary">{pattern.description}</Box>
                          <Button variant="inline-link" onClick={() => {
                            const first = data.nodes.find((node) => pattern.nodeIds.includes(node.id));
                            if (first) {
                              setQuery(first.name.replace(/_(db|kms_key|volume_snapshots?|irsa_s3|s3_bucket).*$/, ""));
                              setGraphMode("components");
                            }
                          }}>Explore pattern</Button>
                        </SpaceBetween>
                      ))}
                    </ColumnLayout>
                  </Container>
                  <Container header={<Header variant="h2">Shared tags and ownership metadata</Header>}>
                    <KeyValuePairs columns={2} items={data.commonTags.map((tag) => ({ label: tag.name, value: tag.value }))} />
                  </Container>
                </SpaceBetween>
              ),
            },
            {
              label: "Terraform details",
              id: "configuration",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2">Providers and environments</Header>}>
                    <KeyValuePairs columns={3} items={[
                      { label: "Providers", value: data.providers.map((provider) => provider.name).join(", ") },
                      { label: "Environments", value: data.environments.join(", ") || "None detected" },
                      { label: "Root inputs", value: data.metrics.variables },
                      { label: "Root outputs", value: data.metrics.outputs },
                      { label: "Terraform files", value: data.metrics.files },
                      { label: "Branch analyzed", value: data.branch },
                      { label: "Source revision", value: <Box variant="code">{data.sourceRevision.slice(0, 12)}</Box> },
                    ]} />
                  </Container>
                  <Table
                    variant="container"
                    trackBy="name"
                    items={data.providers}
                    header={<Header variant="h2" counter={`(${data.providers.length})`} description="Tools Terraform uses to communicate with cloud and platform APIs.">Infrastructure providers</Header>}
                    columnDefinitions={[
                      { id: "name", header: "Provider", cell: (item) => <Box variant="code">{item.name}</Box> },
                      { id: "source", header: "Source", cell: (item) => item.source ?? "Configured by Terraform" },
                      { id: "version", header: "Allowed version", cell: (item) => item.version ?? "Not constrained here" },
                    ]}
                  />
                  <Table
                    variant="container"
                    trackBy="name"
                    items={rootVariables}
                    header={<Header variant="h2" counter={`(${rootVariables.length})`} description="Values operators can provide to customize an environment.">Environment inputs</Header>}
                    columnDefinitions={[
                      { id: "name", header: "Input", cell: (item) => <Box variant="code">{item.name}</Box> },
                      { id: "purpose", header: "Purpose", cell: (item) => item.description ?? "No description provided" },
                      { id: "required", header: "Required", cell: (item) => item.required ? <StatusIndicator type="warning">Required</StatusIndicator> : "Optional" },
                      { id: "default", header: "Default", cell: (item) => item.defaultValue ?? "Provided by environment" },
                    ]}
                  />
                  <Table
                    variant="container"
                    trackBy="name"
                    items={rootOutputs}
                    header={<Header variant="h2" counter={`(${rootOutputs.length})`} description="Information made available after this stack is deployed.">Stack outputs</Header>}
                    columnDefinitions={[
                      { id: "name", header: "Output", cell: (item) => <Box variant="code">{item.name}</Box> },
                      { id: "purpose", header: "Purpose", cell: (item) => item.description ?? "Exposes deployed infrastructure information" },
                      { id: "value", header: "Source", cell: (item) => <Box variant="code">{item.sensitive ? "Sensitive value hidden" : item.value}</Box> },
                    ]}
                  />
                </SpaceBetween>
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

export function InfrastructureNodeDrawer({
  node,
  data,
  onSelect,
}: {
  node: InfrastructureNode;
  data: InfrastructureExplorerData;
  onSelect: (node: InfrastructureNode) => void;
}) {
  const byId = new Map(data.nodes.map((candidate) => [candidate.id, candidate]));
  const upstream = node.dependencies.map((id) => byId.get(id)).filter((item): item is InfrastructureNode => Boolean(item));
  const downstream = node.dependents.map((id) => byId.get(id)).filter((item): item is InfrastructureNode => Boolean(item));

  const relationshipList = (items: InfrastructureNode[], empty: string) => items.length ? (
    <SpaceBetween size="xs">
      {items.map((item) => (
        <Button key={item.id} variant="inline-link" onClick={() => onSelect(item)}>{human(item.name)} · {item.system}</Button>
      ))}
    </SpaceBetween>
  ) : <Box color="text-body-secondary">{empty}</Box>;

  return (
    <Drawer
      header={human(node.name)}
      footer={<DrawerPrimaryButton href={node.sourceUrl} external>View definition on GitHub</DrawerPrimaryButton>}
    >
      <SpaceBetween size="l">
        {node.scope !== "root" ? <StatusIndicator type="pending">Reusable local module definition</StatusIndicator> : node.managed ? <StatusIndicator type="success">Created or managed by this repository</StatusIndicator> : <StatusIndicator type="info">Existing infrastructure reference</StatusIndicator>}
        <Box fontSize="body-m">{node.summary}</Box>
        <KeyValuePairs items={[
          { label: "Logical system", value: node.system },
          { label: "Category", value: node.category },
          { label: "Component type", value: human(node.type) },
          { label: "Provider", value: node.provider },
          { label: "Terraform address", value: <Box variant="code">{node.address}</Box> },
          { label: "Defined at", value: <Link href={node.sourceUrl} external>{node.file}:{node.line}</Link> },
          ...(node.source ? [{ label: "Module source", value: node.source }] : []),
          ...(node.version ? [{ label: "Module version", value: node.version }] : []),
        ]} />

        {node.repetition ? <Container header={<Header variant="h3">Deployment pattern</Header>}><Box>{node.repetition}</Box></Container> : null}

        <Container header={<Header variant="h3" counter={`(${upstream.length})`}>What this component relies on</Header>}>
          {relationshipList(upstream, "No direct upstream dependencies were discovered.")}
        </Container>
        <Container header={<Header variant="h3" counter={`(${downstream.length})`}>What relies on this component</Header>}>
          {relationshipList(downstream, "No downstream dependencies were discovered.")}
        </Container>

        {node.attributes.length ? (
          <Container header={<Header variant="h3">Important configuration</Header>}>
            <KeyValuePairs items={node.attributes.slice(0, 8).map((attribute) => ({ label: attribute.name, value: attribute.value }))} />
          </Container>
        ) : null}

        <ExpandableSection headerText="Implementation details" variant="container">
          <SpaceBetween size="m">
            <KeyValuePairs items={[
              { label: "Variables used", value: node.variableReferences.length ? node.variableReferences.map((item) => `var.${item}`).join(", ") : "None" },
              { label: "Local values used", value: node.localReferences.length ? node.localReferences.map((item) => `local.${item}`).join(", ") : "None" },
              { label: "Scope", value: node.scope === "root" ? "Root stack" : `Reusable ${node.scope} definition` },
            ]} />
            <pre className="terraform-source"><code>{node.implementation}</code></pre>
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    </Drawer>
  );
}
