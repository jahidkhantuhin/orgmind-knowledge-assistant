import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';
const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@orgmind.local';
const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeThisPassword123!';

test('admin can sign in, upload a document, and receive a cited answer', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  const unique = randomUUID().slice(0, 8);
  const documentName = `Playwright Demo ${unique}.md`;
  const verificationPhrase = `LANTERN-${unique}-COPPER-7319`;
  let organizationId: string | undefined;
  let documentId: string | undefined;

  try {
    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('http://localhost:3001/');

    await page.locator('a[href="/knowledge"]').first().click();
    const uploadResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && /\/documents$/.test(url.pathname);
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: documentName,
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        `# Northwind Logistics verification facts\n\nThe one-time verification phrase for Playwright record ${unique} is ${verificationPhrase}.\n`,
      ),
    });
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.ok()).toBeTruthy();
    const uploadPayload = (await uploadResponse.json()) as {
      document: { id: string; status: string };
    };
    documentId = uploadPayload.document.id;
    const pathParts = new URL(uploadResponse.url()).pathname.split('/');
    organizationId = pathParts[pathParts.length - 2];

    const uploadedRow = page.locator('tr').filter({ hasText: documentName });
    await expect(uploadedRow).toBeVisible();
    await expect(uploadedRow.getByText('Ready', { exact: true })).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    await page.getByRole('link', { name: 'Assistant' }).click();
    const newConversationResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && /\/chat\/conversations$/.test(url.pathname);
    });
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    const newConversationResponse = await newConversationResponsePromise;
    expect(newConversationResponse.ok()).toBeTruthy();
    await expect(
      page.getByRole('heading', { name: 'New conversation', exact: true }),
    ).toBeVisible();
    const question = `What is the one-time verification phrase for Playwright record ${unique}?`;
    await page.getByPlaceholder('Ask a question about your documents…').fill(question);
    await page.getByRole('button', { name: /Send/ }).click();

    await expect(page.getByText(verificationPhrase, { exact: false })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('button', { name: new RegExp(documentName) })).toBeVisible();
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({
      path: 'docs/screenshots/assistant-cited-answer.png',
      fullPage: true,
    });
  } finally {
    if (organizationId && documentId) {
      const cookies = await page.context().cookies(apiUrl);
      const cookieHeader = cookies
        .map(({ name: cookieName, value }) => `${cookieName}=${value}`)
        .join('; ');
      await page.request
        .delete(`${apiUrl}/organizations/${organizationId}/documents/${documentId}`, {
          headers: { cookie: cookieHeader },
        })
        .catch(() => undefined);
    }
  }
});
