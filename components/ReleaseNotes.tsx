import Box from "@cloudscape-design/components/box";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function releaseNotesMarkdown(notes: string) {
  const lines = notes.split(/\r?\n/);
  while (lines[0]?.trim() === "") lines.shift();
  if (/^#{1,2}\s+/.test(lines[0] ?? "")) lines.shift();
  while (lines[0]?.trim() === "") lines.shift();
  if (/^(?:#{1,3}\s+)?\[?release notes/i.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n").trim();
}

export function ReleaseNotes({ product, version, notes }: {
  product: string;
  version: string | null;
  notes: string | null;
}) {
  const content = notes ? releaseNotesMarkdown(notes) : null;

  return (
    <ExpandableSection defaultExpanded variant="inline" headerText={`${product} ${version ?? "latest"} release notes`}>
      {content ? (
        <div className="release-notes">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
              img: () => null,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : <Box color="text-body-secondary">No release notes were published for this release.</Box>}
    </ExpandableSection>
  );
}
