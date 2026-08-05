import OperationsConsole from "@/components/OperationsConsole";

export default async function RepositoryPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return <OperationsConsole view="repository" repository={`${owner}/${repo}`} />;
}
