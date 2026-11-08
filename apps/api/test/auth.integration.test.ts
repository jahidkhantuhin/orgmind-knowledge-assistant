import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { closeConnections, getDatabase } from '../src/lib/connections.js';
import { checkMongo } from '../src/lib/connections.js';
import { runMigrations } from '../src/db/migrations/runner.js';

describe('authentication flow', () => {
  afterAll(async () => {
    if (env.TEST_MONGODB_DATABASE === env.MONGODB_DATABASE) {
      throw new Error('TEST_MONGODB_DATABASE must be separate from MONGODB_DATABASE.');
    }
    if (await checkMongo()) await getDatabase().dropDatabase();
    await closeConnections();
  });

  it('registers, returns the admin membership, logs out, and signs in again', async ({ skip }) => {
    if (!(await checkMongo())) skip();
    if (env.TEST_MONGODB_DATABASE === env.MONGODB_DATABASE) {
      throw new Error('TEST_MONGODB_DATABASE must be separate from MONGODB_DATABASE.');
    }

    await runMigrations();
    const database = getDatabase();
    await Promise.all(
      ['users', 'sessions', 'accounts', 'verifications', 'organizations', 'memberships'].map(
        (name) => database.collection(name).deleteMany({}),
      ),
    );

    const agent = request.agent(app);
    const email = `auth-${randomUUID()}@orgmind.test`;
    const password = 'OrgMindIntegration2026!';
    const registration = await agent.post('/auth/register').send({
      workspaceMode: 'create',
      name: 'Integration Admin',
      organizationName: 'Example Workspace',
      email,
      password,
    });

    expect(registration.status).toBe(201);
    expect(registration.body.user).toMatchObject({ name: 'Integration Admin', email });

    const currentUser = await agent.get('/auth/me');
    expect(currentUser.status).toBe(200);
    expect(currentUser.body.organizations).toHaveLength(1);
    expect(currentUser.body.organizations[0]).toMatchObject({
      organizationName: 'Example Workspace',
      role: 'admin',
    });

    const organizationId = currentUser.body.organizations[0].organizationId as string;
    const members = await agent.get(`/organizations/${organizationId}/members`);
    expect(members.status).toBe(200);
    expect(members.body.members).toHaveLength(1);
    expect(members.body.members[0]).toMatchObject({ email, role: 'admin' });

    expect((await agent.post('/auth/logout')).status).toBe(200);
    expect((await agent.get('/auth/me')).status).toBe(401);
    expect((await agent.post('/auth/login').send({ email, password })).status).toBe(200);
    expect((await agent.get('/auth/me')).status).toBe(200);
  }, 30_000);
});
