import { expect, test } from "@playwright/test";

const setupStatus = {
  configured: false,
  hasToken: false,
  tokenSource: null,
  repositorySource: "unconfigured",
  repositories: [],
  viewer: null,
  renovateReviewDay: "friday",
  workspacePresets: [],
  gitlab: { hasToken: false, tokenSource: null, environmentAvailable: false, viewer: null, projects: [], defaultProject: null },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/setup/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(setupStatus) }));
});

test("shows the local-first setup without exposing a credential", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to UDS Scout" })).toBeVisible();
  await page.getByRole("button", { name: "Set up UDS Scout" }).click();
  await expect(page.getByRole("heading", { name: "Connect GitHub", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect Defense Unicorns Registry" })).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText(/github_pat_[a-z0-9_-]+/i);
});

test("returns baseline browser security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(response.headers()["permissions-policy"]).toContain("camera=()");
});
