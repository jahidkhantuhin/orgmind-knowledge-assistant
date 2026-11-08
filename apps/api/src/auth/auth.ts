import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { betterAuth } from 'better-auth/minimal';
import { env } from '../config/env.js';
import { getDatabase, mongoClient } from '../lib/connections.js';
import { provisionPersonalOrganization } from '../modules/organizations/organizations.service.js';

export const auth = betterAuth({
  appName: 'OrgMind',
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  database: mongodbAdapter(getDatabase(), { client: mongoClient }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  user: {
    modelName: 'users',
    additionalFields: {
      organizationName: {
        type: 'string',
        required: false,
        input: true,
      },
    },
  },
  session: {
    modelName: 'sessions',
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  account: { modelName: 'accounts' },
  verification: { modelName: 'verifications' },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (typeof user.organizationName === 'string' && user.organizationName.trim()) {
            await provisionPersonalOrganization(user.id, user.organizationName.trim());
          }
        },
      },
    },
  },
});
