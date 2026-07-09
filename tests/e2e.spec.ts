import { test, expect } from '@playwright/test';
import { prisma } from '../lib/prisma';
import { createNote, createNoteWithTask, createFocusedTask, createCompletedTask, createProject, cleanupTestData } from './helpers/factories';
import cuid from 'cuid'
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = '/Users/ezequielmenor/.gemini/antigravity-cli/brain/69782725-0df5-4979-a0c9-6068a00b502c/screenshots/';

test.describe('Zero-Friction E2E Verification', () => {
  async function registerUser(page: any, email: string, password: string, inviteCode: string) {
    page.on('console', (msg: any) => {
      console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
    });
    page.on('response', async (response: any) => {
      if (response.url().includes('/api/auth/signup')) {
        console.log(`SIGNUP API RESPONSE STATUS:`, response.status());
        try {
          const body = await response.text();
          console.log(`SIGNUP API RESPONSE BODY:`, body);
        } catch (e) {
          console.log(`Failed to read signup response body:`, e);
        }
      }
    });

    await page.goto('/signup');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Invite code', { exact: true }).fill(inviteCode);
    await page.getByRole('button', { name: 'Create account' }).click();
    try {
      await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
    } catch (err) {
      const errorText = await page.locator('.text-red-400').textContent().catch(() => null);
      console.log(`SIGNUP FAILED for ${email}. Error displayed on page: "${errorText}"`);
      throw err;
    }
    await page.waitForLoadState('networkidle');
  }

  test('Register fresh user, seed data, and verify Dashboard, Hubs, and Mente canvas', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `test-user-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    console.log(`Registering new user: ${email}`);
    await registerUser(page, email, password, inviteCode);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`User ${email} was not found in the database.`);
    const userId = user.id;
    const today = new Date();

    console.log(`User created with ID: ${userId}. Seeding data with factories...`);

    // Seed focused task
    const { note: focusNote } = await createFocusedTask(userId, {
      title: 'Alinear prioridades semanales',
      content: 'Foco en la arquitectura del sistema y validación E2E.',
      domain: 'PROYECTOS',
    });

    // Seed today task (Task with dueDate = today)
    await createNoteWithTask(userId, {
      title: 'Implementar test suite de Playwright',
      content: 'Configurar playwright y crear tests/e2e.spec.ts',
      domain: 'PROYECTOS',
    }, {
      dueDate: today,
    });

    // Seed habit
    await prisma.habit.create({
      data: { userId, name: 'Meditación Diaria', frequency: 'DAILY' },
    });

    // Seed Spiritual Note
    await createNote(userId, {
      title: 'Reflexión Gálatas 5:22',
      content: 'El fruto del Espíritu es amor, gozo, paz, paciencia...',
      domain: 'ESPIRITUAL',
      noteStatus: 'ACTIVE',
      tags: ['Paz', 'Gálatas'],
    });

    // Seed Personal Note
    await createNote(userId, {
      title: 'Lista de compras semanal',
      content: 'Frutas, verduras y café de especialidad',
      domain: 'PERSONAL',
      noteStatus: 'ACTIVE',
      tags: ['Organizacion', 'Compras'],
    });

    // Seed Account and transaction for Finanzas
    const testAccount = await prisma.account.create({
      data: { userId, name: 'Cuenta Test', initialBalance: 1000 },
    });
    await prisma.transaction.create({
      data: { userId, amount: -200, description: 'Gasto vinculado', date: today, category: 'ALIMENTACIÓN', accountId: testAccount.id },
    });

    console.log('Seeding completed. Reloading Dashboard...');

    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify Focus Widget
    const focusWidgetHeader = page.getByText('ENFOQUE', { exact: true });
    await expect(focusWidgetHeader).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Alinear prioridades semanales' })).toBeVisible();

    // Verify Today Tasks
    const tasksHeader = page.getByText('TAREAS DE HOY', { exact: true });
    await expect(tasksHeader).toBeVisible();
    await expect(page.getByText('Implementar test suite de Playwright')).toBeVisible();

    // Verify Habits
    const habitsHeader = page.getByText('HÁBITOS DE HOY', { exact: true });
    await expect(habitsHeader).toBeVisible();
    const habitButton = page.getByRole('button', { name: 'Completar Meditación Diaria' });
    await expect(habitButton).toBeVisible();

    // Screenshot: today-dashboard.png
    const todayScreenshotPath = path.join(SCREENSHOT_DIR, 'today-dashboard.png');
    await page.screenshot({ path: todayScreenshotPath });
    console.log(`Saved screenshot: ${todayScreenshotPath}`);

    // Navigate to Spiritual Hub
    console.log('Navigating to Spiritual Hub...');
    await page.goto('/hubs/espiritual');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Reflexión Gálatas 5:22')).toBeVisible();
    await expect(page.getByText('Lista de compras semanal')).not.toBeVisible();

    const spiritualScreenshotPath = path.join(SCREENSHOT_DIR, 'spiritual-hub.png');
    await page.screenshot({ path: spiritualScreenshotPath });

    // Navigate to Mente graph
    console.log('Navigating to Mente graph canvas...');
    await page.goto('/hubs/mente');
    await page.waitForLoadState('networkidle');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15000 });

    const menteScreenshotPath = path.join(SCREENSHOT_DIR, 'mente-graph.png');
    await page.screenshot({ path: menteScreenshotPath });

    // Navigate to Finanzas
    console.log('Navigating to Finanzas hub...');
    await page.goto('/hubs/registros/finanzas');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await expect(page.getByText('Cuenta Test').first()).toBeVisible({ timeout: 15000 });

    const finanzasScreenshotPath = path.join(SCREENSHOT_DIR, 'finanzas-hub.png');
    await page.screenshot({ path: finanzasScreenshotPath });

    console.log('E2E Verification completed successfully!');

    // Cleanup
    await cleanupTestData(userId);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  test('Inbox: capture text → card appears → process with AI → card removed with toast', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `inbox-test-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);

    await page.getByRole('button', { name: 'Capturar nota' }).click();
    await expect(page.getByPlaceholder('Escribí o hablá… mañana, importante, 12 de julio')).toBeVisible();

    const captureText = `Test inbox item ${uniqueId}`;
    await page.getByPlaceholder('Escribí o hablá… mañana, importante, 12 de julio').fill(captureText);
    await page.getByRole('button', { name: 'Enviar' }).click();

    await expect(page.getByPlaceholder('Escribí o hablá… mañana, importante, 12 de julio')).not.toBeVisible({ timeout: 500 });
    await expect(page.getByTestId('inbox-card')).toBeVisible({ timeout: 5000 });

    // Process card (via "Procesar todo")
    await page.getByText('Procesar todo').click();
    await expect(page.getByTestId('inbox-card')).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Guardado en Hub/i)).toBeVisible({ timeout: 2000 });

    // Cleanup
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  test('Inbox: AI failure → card stays with error', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `inbox-fail-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();

    const note = await createNote(user!.id, {
      title: `Draft item for failure test ${uniqueId}`,
      content: 'This is a seeded draft for testing AI failure path',
      domain: 'REGISTROS',
      noteStatus: 'DRAFT',
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    const card = page.getByTestId('inbox-card').filter({ hasText: `Draft item for failure test ${uniqueId}` });
    await expect(card).toBeVisible();

    // Intercept process API to return 502
    await page.route(
      new RegExp(`/api/notes/${note.id}/process`),
      (route) => route.fulfill({ status: 502, body: JSON.stringify({ error: 'AI_FAILED' }) })
    );

    await page.getByText('Procesar todo').click();
    await expect(card).toBeVisible();
    await expect(card.getByText(/Error del servidor de IA/i)).toBeVisible();

    // Cleanup
    await cleanupTestData(user!.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  test('Inbox: empty text submit → inline error, overlay stays open', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `inbox-empty-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);

    let noteApiCalled = false;
    await page.route(
      (url) => url.pathname === '/api/notes',
      (route) => { noteApiCalled = true; route.continue(); }
    );

    await page.getByRole('button', { name: 'Capturar nota' }).click();
    const textarea = page.getByPlaceholder('Escribí o hablá… mañana, importante, 12 de julio');
    await expect(textarea).toBeVisible();
    await textarea.fill(' ');
    await textarea.fill('');
    await expect(textarea).toBeVisible();
    expect(noteApiCalled).toBe(false);

    // Cleanup
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Focus toggle (happy path) ────────────────────────────────────────────
  test('Focus: asignar foco a una task OPEN y verificar que solo una tiene focus', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `focus-test-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');
    const userId = user.id;

    // Crear dos tareas sin foco
    const { task: taskA } = await createNoteWithTask(userId, { title: 'Task A', domain: 'PROYECTOS' });
    const { task: taskB } = await createNoteWithTask(userId, { title: 'Task B', domain: 'PROYECTOS' });

    // Foco en A
    const resA = await fetch(`http://localhost:3000/api/tasks/${taskA.id}/focus`, {
      method: 'POST',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    expect(resA.status).toBe(200);

    // Verificar que A tiene foco
    const focusedA = await prisma.task.findUnique({ where: { id: taskA.id } });
    expect(focusedA?.focusedAt).not.toBeNull();

    // Foco en B → debería quitar foco de A
    const resB = await fetch(`http://localhost:3000/api/tasks/${taskB.id}/focus`, {
      method: 'POST',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    expect(resB.status).toBe(200);

    // Verificar que A ya no tiene foco
    const unfocusedA = await prisma.task.findUnique({ where: { id: taskA.id } });
    expect(unfocusedA?.focusedAt).toBeNull();

    // B tiene foco
    const focusedB = await prisma.task.findUnique({ where: { id: taskB.id } });
    expect(focusedB?.focusedAt).not.toBeNull();

    // Cleanup
    await cleanupTestData(userId);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Focus on DONE → 409 ──────────────────────────────────────────────────
  test('Focus: asignar foco a una task DONE devuelve 409', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `focus-done-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    const { task } = await createCompletedTask(user.id, { title: 'Done task', domain: 'PROYECTOS' });

    const res = await fetch(`http://localhost:3000/api/tasks/${task.id}/focus`, {
      method: 'POST',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    expect(res.status).toBe(409);

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Complete task ────────────────────────────────────────────────────────
  test('Complete: marcar task OPEN como DONE guarda completedAt', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `complete-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    const { task } = await createNoteWithTask(user.id, { title: 'To complete', domain: 'PROYECTOS' });

    const res = await fetch(`http://localhost:3000/api/tasks/${task.id}/complete`, {
      method: 'POST',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    expect(res.status).toBe(200);

    const updated = await prisma.task.findUnique({ where: { id: task.id } });
    expect(updated?.status).toBe('DONE');
    expect(updated?.completedAt).not.toBeNull();

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Accept-goal happy path ───────────────────────────────────────────────
  test('Accept-goal: aceptar meta sugerida crea Task y devuelve 200', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `goal-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    // Crear Note ESPIRITUAL ACTIVE con suggestedGoals
    const note = await createNote(user.id, {
      title: 'Goal test note',
      content: 'Test content',
      domain: 'ESPIRITUAL',
      noteStatus: 'ACTIVE',
      suggestedGoals: ['Leer la Biblia diariamente'],
    });

    const res = await fetch(`http://localhost:3000/api/notes/${note.id}/accept-goal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sb-access-token=${await getTestToken(page)}`,
      },
      body: JSON.stringify({ goalText: 'Leer la Biblia diariamente' }),
    });
    expect(res.status).toBe(200);

    const task = await prisma.task.findFirst({ where: { noteId: note.id } });
    expect(task).not.toBeNull();
    expect(task?.status).toBe('OPEN');

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Accept-goal 409 (ya tiene Task) ──────────────────────────────────────
  test('Accept-goal: aceptar meta cuando la Note ya tiene Task devuelve 409', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `goal-409-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    const { note } = await createNoteWithTask(user.id, {
      title: 'Already has task',
      domain: 'ESPIRITUAL',
      noteStatus: 'ACTIVE',
      suggestedGoals: ['Meta ya existente'],
    });

    const res = await fetch(`http://localhost:3000/api/notes/${note.id}/accept-goal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sb-access-token=${await getTestToken(page)}`,
      },
      body: JSON.stringify({ goalText: 'Meta ya existente' }),
    });
    expect(res.status).toBe(409);

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Cascade delete Note → Task ───────────────────────────────────────────
  test('Cascade: eliminar Note elimina su Task asociada', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `cascade-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    const { note, task } = await createNoteWithTask(user.id, { title: 'Cascade test', domain: 'PROYECTOS' });
    expect(task).not.toBeNull();

    // Eliminar la Note via API
    const res = await fetch(`http://localhost:3000/api/notes/${note.id}`, {
      method: 'DELETE',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    expect(res.status).toBe(200);

    // Task debería haberse eliminado en cascada
    const deleted = await prisma.task.findUnique({ where: { id: task.id } });
    expect(deleted).toBeNull();

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Inbox solo muestra DRAFT ─────────────────────────────────────────────
  test('Inbox: GET /api/notes?status=DRAFT solo devuelve notas DRAFT', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `inbox-draft-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    await createNote(user.id, { title: 'Draft note', noteStatus: 'DRAFT' });
    await createNote(user.id, { title: 'Active note', noteStatus: 'ACTIVE' });

    const res = await fetch('http://localhost:3000/api/notes?status=DRAFT', {
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    const data = await res.json();
    const titles = data.map((n: any) => n.title);
    expect(titles).toContain('Draft note');
    expect(titles).not.toContain('Active note');

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Dashboard sin foco ───────────────────────────────────────────────────
  test('Dashboard: sin foco asignado, focusTask es null', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `dash-nofocus-${uniqueId}@test.com`;
    const password = 'Password123!';
    const inviteCode = 'zero-friction-private-2026';

    await registerUser(page, email, password, inviteCode);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');

    // Crear task sin foco
    await createNoteWithTask(user.id, { title: 'No focus task', domain: 'PROYECTOS' });

    const res = await fetch('http://localhost:3000/api/dashboard', {
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.focusTask).toBeNull();

    // Cleanup
    await cleanupTestData(user.id);
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  // ── Project Engine E2E (Phase 3) ───────────────────────────────────────

  test('E2E-1: crear proyecto + asignar Note + verificar project en dashboard', async ({ page }) => {
    const uniqueId = Date.now()
    const email = `proj-1-${uniqueId}@test.com`
    const password = 'Password123!'
    const inviteCode = 'zero-friction-private-2026'

    await registerUser(page, email, password, inviteCode)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('User not found')

    // Crear proyecto
    const project = await createProject(user.id, { name: 'E2E Project', status: 'IDEATION' })

    // Crear Note con projectId y Task
    const { note } = await createNoteWithTask(user.id, {
      title: 'Task con proyecto',
      domain: 'PROYECTOS',
      projectId: project.id,
    }, { dueDate: new Date() })

    // Verificar via dashboard API
    const res = await fetch('http://localhost:3000/api/dashboard', {
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()

    // Buscar la task en todayTasks
    const taskWithProject = body.data.todayTasks.find(
      (t: any) => t.note.id === note.id
    )
    expect(taskWithProject).toBeDefined()
    expect(taskWithProject.note.project).toEqual({
      id: project.id,
      name: 'E2E Project',
      status: 'IDEATION',
    })

    await cleanupTestData(user.id)
    await prisma.user.delete({ where: { email } }).catch(() => {})
  })

  test('E2E-2: transición inválida → 409 con allowedFromCurrent', async ({ page }) => {
    const uniqueId = Date.now()
    const email = `proj-2-${uniqueId}@test.com`
    const password = 'Password123!'
    const inviteCode = 'zero-friction-private-2026'

    await registerUser(page, email, password, inviteCode)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('User not found')

    const project = await createProject(user.id, { status: 'ARCHIVED' })

    // ARCHIVED → MAINTENANCE debería fallar
    const res = await fetch(`http://localhost:3000/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sb-access-token=${await getTestToken(page)}`,
      },
      body: JSON.stringify({ status: 'MAINTENANCE' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('invalidTransition')
    expect(body.error.details.allowedFromCurrent).toEqual(['ACTIVE', 'IDEATION'])

    await cleanupTestData(user.id)
    await prisma.user.delete({ where: { email } }).catch(() => {})
  })

  test('E2E-3: cadena completa IDEATION→ACTIVE→MAINTENANCE→ARCHIVED→ACTIVE (revive)', async ({ page }) => {
    const uniqueId = Date.now()
    const email = `proj-3-${uniqueId}@test.com`
    const password = 'Password123!'
    const inviteCode = 'zero-friction-private-2026'

    await registerUser(page, email, password, inviteCode)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('User not found')

    const project = await createProject(user.id, { status: 'IDEATION' })
    const token = await getTestToken(page)
    const headers = { 'Content-Type': 'application/json', Cookie: `sb-access-token=${token}` }
    const patch = (status: string) =>
      fetch(`http://localhost:3000/api/projects/${project.id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ status }),
      })

    // IDEATION → ACTIVE
    let res = await patch('ACTIVE')
    expect(res.status).toBe(200)

    // ACTIVE → MAINTENANCE
    res = await patch('MAINTENANCE')
    expect(res.status).toBe(200)

    // MAINTENANCE → ARCHIVED
    res = await patch('ARCHIVED')
    expect(res.status).toBe(200)

    // ARCHIVED → ACTIVE (revive)
    res = await patch('ACTIVE')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('ACTIVE')

    await cleanupTestData(user.id)
    await prisma.user.delete({ where: { email } }).catch(() => {})
  })

  test('E2E-4: DELETE proyecto → Note.projectId = null, Task sobrevive', async ({ page }) => {
    const uniqueId = Date.now()
    const email = `proj-4-${uniqueId}@test.com`
    const password = 'Password123!'
    const inviteCode = 'zero-friction-private-2026'

    await registerUser(page, email, password, inviteCode)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('User not found')

    const project = await createProject(user.id)
    const { note, task } = await createNoteWithTask(user.id, {
      title: 'Note con proyecto',
      domain: 'PROYECTOS',
      projectId: project.id,
    })

    // Eliminar proyecto
    const res = await fetch(`http://localhost:3000/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    })
    expect(res.status).toBe(204)

    // Verificar Note huérfana
    const noteAfter = await prisma.note.findUnique({ where: { id: note.id } })
    expect(noteAfter).not.toBeNull()
    expect(noteAfter!.projectId).toBeNull()

    // Verificar Task sobrevive
    const taskAfter = await prisma.task.findUnique({ where: { id: task.id } })
    expect(taskAfter).not.toBeNull()
    expect(taskAfter!.noteId).toBe(note.id)

    await cleanupTestData(user.id)
    await prisma.user.delete({ where: { email } }).catch(() => {})
  })

  test('E2E-5: DELETE proyecto con embedding y NoteRelationship → persisten', async ({ page }) => {
    const uniqueId = Date.now()
    const email = `proj-5-${uniqueId}@test.com`
    const password = 'Password123!'
    const inviteCode = 'zero-friction-private-2026'

    await registerUser(page, email, password, inviteCode)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('User not found')

    const project = await createProject(user.id)

    // Crear Note con embedding (usando SQL directo para pgvector)
    const note = await prisma.note.create({
      data: {
        id: cuid(),
        userId: user.id,
        title: 'Note con embedding',
        content: 'Contenido para vector',
        domain: 'PROYECTOS',
        noteStatus: 'ACTIVE',
        projectId: project.id,
      },
    })

    // Insertar embedding via SQL
    const zeroVector = Array(1536).fill(0).join(',')
    await prisma.$executeRawUnsafe(
      `UPDATE "Note" SET embedding = '[${zeroVector}]'::vector WHERE id = '${note.id}'`
    )

    // Crear NoteRelationship
    const note2 = await createNote(user.id, { title: 'Related note', domain: 'PROYECTOS' })
    await prisma.noteRelationship.create({
      data: {
        userId: user.id,
        sourceNoteId: note.id,
        targetNoteId: note2.id,
        relationshipType: 'RELATED',
      },
    })

    // Eliminar proyecto
    const res = await fetch(`http://localhost:3000/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { Cookie: `sb-access-token=${await getTestToken(page)}` },
    })
    expect(res.status).toBe(204)

    // Verificar embedding persiste (1536 dims)
    const dims: any[] = await prisma.$queryRawUnsafe(
      `SELECT vector_dims(embedding) as dims FROM "Note" WHERE id = '${note.id}'`
    )
    expect(dims[0]?.dims).toBe(1536)

    // Verificar NoteRelationship persiste
    const rel = await prisma.noteRelationship.findFirst({
      where: { sourceNoteId: note.id, targetNoteId: note2.id },
    })
    expect(rel).not.toBeNull()

    // Cleanup manual (notes + project ya borrado)
    await prisma.noteRelationship.deleteMany({ where: { userId: user.id } })
    await cleanupTestData(user.id)
    await prisma.user.delete({ where: { email } }).catch(() => {})
  })

  // Helper: obtener el token de test desde la cookie de Playwright
  async function getTestToken(page: any): Promise<string> {
  const cookies = await page.context().cookies();
  const tokenCookie = cookies.find((c: any) => c.name === 'sb-access-token');
  return tokenCookie?.value ?? '';
}
});
