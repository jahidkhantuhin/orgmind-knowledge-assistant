import { auth } from '../src/auth/auth.js';
import { env } from '../src/config/env.js';
import { closeConnections } from '../src/lib/connections.js';
import { closeDocumentIngestionQueue } from '../src/modules/documents/document-ingestion.queue.js';
import { logger } from '../src/lib/logger.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { provisionPersonalOrganization } from '../src/modules/organizations/organizations.service.js';
import { organizationsRepository } from '../src/modules/organizations/organizations.repository.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { documentsRepository } from '../src/modules/documents/documents.repository.js';
import { documentsService } from '../src/modules/documents/documents.service.js';

const demoDocuments = [
  {
    name: 'Northwind Logistics - Employee Handbook.md',
    text: `# Northwind Logistics Employee Handbook\n\n## Paid leave\nEmployees receive 12 paid vacation days each calendar year. Submit vacation requests at least five business days before the first day off. A manager must approve each request.\n\n## Sick leave\nEmployees receive 8 paid sick days per year. Notify your manager before your shift when possible. A medical note is required after three consecutive workdays away.\n\n## Learning and development\nEmployees may request up to $1,200 per year for approved job-related training. Submit the course details to People Operations before enrolling.`,
  },
  {
    name: 'Northwind Logistics - Workplace and IT Policies.md',
    text: `# Northwind Logistics Workplace and IT Policies\n\n## Office hours\nThe Northwind City office is open Monday through Friday, 9:00 a.m. to 5:00 p.m. local time. The main office address is 50 Harbor Way, Northwind City.\n\n## Account security\nUse a unique password with at least 12 characters and enable multi-factor authentication. Report suspected account compromise to the service desk immediately.\n\n## Equipment\nEmployees should return company laptops, access cards, and other equipment to their manager on their final workday.`,
  },
  {
    name: 'Northwind Logistics - Frequently Asked Questions.md',
    text: `# Northwind Logistics Frequently Asked Questions\n\n## How do I request vacation?\nSubmit a request in the People portal at least five business days in advance. Your manager approves or declines the request in the portal.\n\n## Who can help with a payroll question?\nContact the Payroll team through the internal Help Desk. Include the pay period in your message, but never include a full bank account number.\n\n## How do I get software installed?\nOpen a Help Desk request with the software name, business reason, and device asset tag. The IT team will confirm whether the software is approved.`,
  },
];

try {
  await runMigrations();
  let user = await usersRepository.findByEmail(env.SEED_ADMIN_EMAIL);
  if (!user) {
    const created = await auth.api.signUpEmail({
      body: {
        name: env.SEED_ADMIN_NAME,
        email: env.SEED_ADMIN_EMAIL,
        password: env.SEED_ADMIN_PASSWORD,
        organizationName: env.SEED_ORGANIZATION_NAME,
      },
    });
    user = {
      id: created.user.id,
      name: created.user.name,
      email: created.user.email,
    };
  }
  await provisionPersonalOrganization(user.id, env.SEED_ORGANIZATION_NAME);
  const organization = await organizationsRepository.findOwnedBy(user.id);
  if (!organization) throw new Error('The seed account does not have an administrator workspace.');

  const existing = await documentsRepository.listByOrganization(organization._id);
  const existingNames = new Set(existing.map((document) => document.originalName));
  let queued = 0;
  for (const demoDocument of demoDocuments) {
    if (existingNames.has(demoDocument.name)) continue;
    await documentsService.ingestTextContent(
      organization._id,
      user.id,
      demoDocument.name,
      Buffer.from(demoDocument.text, 'utf8'),
      'default',
      ['role:admin', 'role:member', 'role:viewer'],
    );
    queued += 1;
  }
  logger.info(
    { email: user.email, organizationId: organization._id, queued },
    'Seed administrator is ready; demo documents were queued when missing.',
  );
} catch (error) {
  logger.error({ err: error }, 'Database seed failed.');
  process.exitCode = 1;
} finally {
  await closeDocumentIngestionQueue();
  await closeConnections();
}
