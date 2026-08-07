import { NextRequest, NextResponse } from "next/server";
import type { TestLabWorkflowMode } from "@/components/test-lab-types";
import { TEST_LAB_ENABLED } from "@/lib/repository-constants";
import {
  isManagedTestRepository,
  prepareTestLabSession,
  resetTestLabSession,
  startTestLabCleanup,
  startTestLabDeployment,
  testLabBranches,
  testLabCatalog,
  testLabImages,
  testLabPlan,
  testLabSession,
} from "@/lib/test-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function failure(error: unknown) {
  console.error(error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "The Test Lab request failed." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!TEST_LAB_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const repository = request.nextUrl.searchParams.get("repository");
  const branch = request.nextUrl.searchParams.get("branch");
  const status = request.nextUrl.searchParams.get("status");
  const images = request.nextUrl.searchParams.get("images");

  try {
    if (images === "true") {
      return NextResponse.json(await testLabImages(), { headers: { "Cache-Control": "no-store" } });
    }
    if (status === "true") {
      return NextResponse.json(await testLabSession(), { headers: { "Cache-Control": "no-store" } });
    }
    if (repository && branch) {
      if (!isManagedTestRepository(repository)) return NextResponse.json({ error: "That repository is not configured for Test Lab." }, { status: 403 });
      const plan = await testLabPlan(repository, branch);
      if (!plan) return NextResponse.json({ error: "That branch is not available." }, { status: 404 });
      return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
    }
    if (repository) {
      if (!isManagedTestRepository(repository)) return NextResponse.json({ error: "That repository is not configured for Test Lab." }, { status: 403 });
      return NextResponse.json({ branches: await testLabBranches(repository) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(testLabCatalog(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  if (!TEST_LAB_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!localOrigin(request)) {
    return NextResponse.json({ error: "Test Lab requests are accepted only from the local application." }, { status: 403 });
  }

  let body: { action?: unknown; repository?: unknown; branch?: unknown; flavor?: unknown; workflow?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Use a JSON request body." }, { status: 400 });
  }

  try {
    if (body.action === "run-test") {
      if (typeof body.repository !== "string" || typeof body.branch !== "string" || !isManagedTestRepository(body.repository)) {
        return NextResponse.json({ error: "Choose a configured repository and branch." }, { status: 400 });
      }
      const currentSession = await testLabSession();
      if (!currentSession.clusterReachable) {
        return NextResponse.json({ error: "The existing Kubernetes cluster on zeus is not reachable. Test Lab will not create a cluster." }, { status: 409 });
      }
      const workflow: TestLabWorkflowMode | null = body.workflow === "deploy-only" || body.workflow === "build-deploy-test" ? body.workflow : null;
      if (!workflow) return NextResponse.json({ error: "Choose deploy only or deploy and test." }, { status: 400 });
      const plan = await testLabPlan(body.repository, body.branch);
      if (!plan) return NextResponse.json({ error: "That branch is not available." }, { status: 404 });
      const selectedWorkflow = workflow === "deploy-only" ? plan.deployOnly : plan.workflow;
      if (!selectedWorkflow.safe) return NextResponse.json({ error: selectedWorkflow.blockers.join(" ") }, { status: 409 });
      const flavor = typeof body.flavor === "string" && plan.flavors.includes(body.flavor) ? body.flavor : null;
      if (plan.flavors.length && !flavor) {
        return NextResponse.json({ error: "Choose a flavor declared by the selected branch." }, { status: 400 });
      }
      if (!plan.flavors.length && body.flavor !== null && body.flavor !== undefined && body.flavor !== "") {
        return NextResponse.json({ error: "The selected branch does not declare package flavors." }, { status: 400 });
      }
      await prepareTestLabSession(plan, workflow, flavor);
      const session = await startTestLabDeployment();
      const flavorText = flavor ? ` using the ${flavor} flavor` : "";
      const message = workflow === "deploy-only"
        ? `Started the deployment for ${plan.repository}@${plan.branch}${flavorText}.`
        : `Started the build, deployment, and repository tests for ${plan.repository}@${plan.branch}${flavorText}.`;
      return NextResponse.json({ ok: true, message, session });
    }
    if (body.action === "cleanup") {
      const session = await startTestLabCleanup();
      return NextResponse.json({ ok: true, message: "Started UDS bundle cleanup.", session });
    }
    if (body.action === "reset") {
      const session = await resetTestLabSession();
      return NextResponse.json({ ok: true, message: "Cleared the completed Test Lab session.", session });
    }
    return NextResponse.json({ error: "Choose a configured Test Lab action." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
