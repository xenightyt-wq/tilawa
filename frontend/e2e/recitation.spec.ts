import { expect, test, type Page } from '@playwright/test';

async function useSimulation(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Paramètres' }).click();
  await page.getByRole('radio', { name: 'Simulation (sans micro)' }).click();
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByTestId('new-recitation')).toBeVisible();
}

async function recite(page: Page, text: string) {
  await page.getByTestId('sim-input').fill(text);
  await page.getByTestId('sim-send').click();
}

async function reciteExpectedVerse(page: Page) {
  await page.getByTestId('sim-fill').click();
  await page.getByTestId('sim-send').click();
}

test('Al-Fatiha récitée sans faute → 100 %', async ({ page }) => {
  await useSimulation(page);
  await page.getByTestId('demo-fatiha').click();
  await expect(page.locator('.w')).toHaveCount(29);
  for (let i = 0; i < 7; i++) {
    await reciteExpectedVerse(page);
    // attendre que le verset soit validé avant d'envoyer le suivant
    if (i < 6)
      await expect(page.locator('.w-correct')).toHaveCount(
      [4, 8, 10, 13, 17, 20, 29][i],
      { timeout: 10_000 },
    );
  }
  await expect(page.getByTestId('accuracy')).toHaveText('100%');
  await expect(page.getByText('Aucune faute')).toBeVisible();
});

test('Al-Ikhlas : faute détectée, mot attendu affiché, reprise, statistiques', async ({ page }) => {
  await useSimulation(page);
  await page.getByTestId('demo-ikhlas').click();
  await recite(page, 'قل هو الله أحد الله الأحد');
  const banner = page.locator('.banner-error');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText('Mot erroné');
  const expected = await banner.locator('.expected').innerText();
  expect(expected.replace(/[ً-ٰٟٱ]/g, (c) => (c === 'ٱ' ? 'ا' : ''))).toBe('الصمد');
  await expect(page.locator('.w-error')).toHaveCount(1);

  await banner.getByRole('button', { name: 'Reprendre au mot' }).click();
  await expect(banner).toBeHidden();
  await recite(page, 'الصمد لم يلد ولم يولد ولم يكن له كفوا أحد');
  await expect(page.getByTestId('accuracy')).toHaveText('93%', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Accueil' }).click();
  await expect(page.getByTestId('continue')).toContainText('Al-Ikhlaas');
  await page.getByTestId('stats').click();
  await expect(page.getByTestId('history')).toContainText('93%');
  await expect(page.locator('.sura-cell.learning')).toHaveText('112');
});

test('verset sauté signalé', async ({ page }) => {
  await useSimulation(page);
  await page.getByTestId('demo-ikhlas').click();
  await recite(page, 'قل هو الله أحد');
  await expect(page.locator('.w-correct')).toHaveCount(4, { timeout: 10_000 });
  await recite(page, 'لم يلد ولم يولد');
  await expect(page.locator('.banner-error')).toContainText('Verset sauté', { timeout: 10_000 });
});

test('mode mémorisation : texte masqué, indice', async ({ page }) => {
  await useSimulation(page);
  await page.getByTestId('new-recitation').click();
  await page.getByTestId('sura-select').selectOption('112');
  await page.getByTestId('mode-memorize').check();
  await page.getByTestId('start').click();
  await expect(page.locator('.w-hidden')).toHaveCount(15);
  await page.getByRole('button', { name: 'Indice' }).click();
  await expect(page.locator('.w-hinted')).toHaveCount(1);
  await expect(page.locator('.w-hidden')).toHaveCount(14);
});

test('PWA : manifeste, service worker et texte disponibles hors ligne', async ({ page, context }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest?.name).toContain('Tilawa');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // la page est désormais contrôlée par le SW
  await expect(page.getByTestId('new-recitation')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('demo-fatiha').click();
  await expect(page.locator('.w')).toHaveCount(29);
  await context.setOffline(false);
});
