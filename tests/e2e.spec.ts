import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import path from 'path';

// Define the screenshot output directory
const SCREENSHOT_DIR = '/Users/ezequielmenor/.gemini/antigravity-cli/brain/69782725-0df5-4979-a0c9-6068a00b502c/screenshots/';

test.describe('Zero-Friction E2E Verification', () => {
  test('Register fresh user, seed data, and verify Today, Hubs, and Mente canvas', async ({ page }) => {
    // 1. Generate unique email
    const uniqueId = Date.now();
    const email = `test-user-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    console.log(`Registering new user: ${email}`);

    // 2. Go to signup page
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/signup/);

    // 3. Fill signup form
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Invite code', { exact: true }).fill(inviteCode);

    // 4. Submit form
    await page.getByRole('button', { name: 'Create account' }).click();

    // 5. Verify redirection to Home page / dashboard
    await expect(page).toHaveURL(/\/$/);

    // 6. Find user in the database to get their ID
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new Error(`User ${email} was not found in the database after signup.`);
    }

    console.log(`User created with ID: ${user.id}. Seeding tasks, habits, and notes...`);

    const userId = user.id;
    const today = new Date();

    // 7. Seed active focus task (IN_PROGRESS, PROYECTOS)
    const focusTask = await prisma.note.create({
      data: {
        userId,
        title: 'Alinear prioridades semanales',
        content: 'Foco en la arquitectura del sistema y validación E2E.',
        domain: 'PROYECTOS',
        status: 'IN_PROGRESS',
        isImportant: true,
        dueDate: today,
      },
    });

    // 8. Seed active today task (ACTIVE, PROYECTOS)
    const todayTask = await prisma.note.create({
      data: {
        userId,
        title: 'Implementar test suite de Playwright',
        content: 'Configurar playwright y crear tests/e2e.spec.ts',
        domain: 'PROYECTOS',
        status: 'ACTIVE',
        isImportant: false,
        dueDate: today,
      },
    });

    // 9. Seed habit
    const habit = await prisma.habit.create({
      data: {
        userId,
        name: 'Meditación Diaria',
        frequency: 'DAILY',
      },
    });

    // 10. Seed Spiritual Note (ESPIRITUAL)
    const spiritualNote = await prisma.note.create({
      data: {
        userId,
        title: 'Reflexión Gálatas 5:22',
        content: 'El fruto del Espíritu es amor, gozo, paz, paciencia...',
        domain: 'ESPIRITUAL',
        status: 'ACTIVE',
        tags: ['Paz', 'Gálatas'],
      },
    });

    // 11. Seed Personal Note (PERSONAL)
    const personalNote = await prisma.note.create({
      data: {
        userId,
        title: 'Lista de compras semanal',
        content: 'Frutas, verduras y café de especialidad',
        domain: 'PERSONAL',
        status: 'ACTIVE',
        tags: ['Organizacion', 'Compras'],
      },
    });

    // Seed Account and linked transaction for Finanzas
    const testAccount = await prisma.account.create({
      data: {
        userId,
        name: 'Cuenta Test',
        initialBalance: 1000,
      },
    });
    await prisma.transaction.create({
      data: {
        userId,
        amount: -200,
        description: 'Gasto vinculado',
        date: today,
        category: 'ALIMENTACIÓN',
        accountId: testAccount.id,
      },
    });

    console.log('Seeding completed. Reloading Today dashboard...');

    // Ensure screenshot directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    // 12. Reload the page to load seeded data
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 13. Verify Focus Widget
    const focusWidgetHeader = page.getByText('ENFOQUE', { exact: true });
    await expect(focusWidgetHeader).toBeVisible();
    // Use exact role and name for the heading to avoid duplicate with the list item
    await expect(page.getByRole('heading', { name: 'Alinear prioridades semanales' })).toBeVisible();

    // 14. Verify Today Tasks list
    const tasksHeader = page.getByText('TAREAS DE HOY', { exact: true });
    await expect(tasksHeader).toBeVisible();
    await expect(page.getByText('Implementar test suite de Playwright')).toBeVisible();

    // 15. Verify Habit row / widget
    const habitsHeader = page.getByText('HÁBITOS DE HOY', { exact: true });
    await expect(habitsHeader).toBeVisible();
    // Meditación Diaria -> initials "MD"
    const habitButton = page.getByRole('button', { name: 'Completar Meditación Diaria' });
    await expect(habitButton).toBeVisible();
    await expect(habitButton).toHaveText('MD');

    // 16. Take today-dashboard.png screenshot
    const todayScreenshotPath = path.join(SCREENSHOT_DIR, 'today-dashboard.png');
    await page.screenshot({ path: todayScreenshotPath });
    console.log(`Saved screenshot: ${todayScreenshotPath}`);

    // 17. Navigate to Spiritual Hub
    console.log('Navigating to Spiritual Hub...');
    await page.goto('/hubs/espiritual');
    await page.waitForLoadState('networkidle');

    // Check context isolation: Spiritual Note visible, Personal Note not visible
    await expect(page.getByText('Reflexión Gálatas 5:22')).toBeVisible();
    await expect(page.getByText('Lista de compras semanal')).not.toBeVisible();

    // 18. Take spiritual-hub.png screenshot
    const spiritualScreenshotPath = path.join(SCREENSHOT_DIR, 'spiritual-hub.png');
    await page.screenshot({ path: spiritualScreenshotPath });
    console.log(`Saved screenshot: ${spiritualScreenshotPath}`);

    // 19. Navigate to Mente graph
    console.log('Navigating to Mente graph canvas...');
    await page.goto('/hubs/mente');
    await page.waitForLoadState('networkidle');

    // Check that canvas element exists and is visible
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // 20. Take mente-graph.png screenshot
    const menteScreenshotPath = path.join(SCREENSHOT_DIR, 'mente-graph.png');
    await page.screenshot({ path: menteScreenshotPath });
    console.log(`Saved screenshot: ${menteScreenshotPath}`);

    // 21. Navigate to Finanzas hub
    console.log('Navigating to Finanzas hub...');
    await page.goto('/hubs/registros/finanzas');
    await page.waitForLoadState('networkidle');

    // Verify account panel shows account with correct currentBalance (1000 - 200 = 800)
    await expect(page.getByText('Cuenta Test')).toBeVisible();
    await expect(page.getByText('$800')).toBeVisible();

    // 22. Take finanzas-hub.png screenshot
    const finanzasScreenshotPath = path.join(SCREENSHOT_DIR, 'finanzas-hub.png');
    await page.screenshot({ path: finanzasScreenshotPath });
    console.log(`Saved screenshot: ${finanzasScreenshotPath}`);

    console.log('E2E Verification completed successfully!');
  });
});
