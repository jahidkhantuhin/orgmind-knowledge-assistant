import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { membershipsRepository } from '../src/modules/organizations/memberships.repository.js';
import { requireOrganizationRole } from '../src/auth/auth.middleware.js';

vi.mock('../src/modules/organizations/memberships.repository.js', () => ({
  membershipsRepository: {
    findForUserInOrganization: vi.fn(),
  },
}));

describe('organization role guard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('allows an admin for an organization', async () => {
    vi.mocked(membershipsRepository.findForUserInOrganization).mockResolvedValue({
      _id: 'membership-1',
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'admin',
      groupIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const req = {
      authSession: { user: { id: 'user-1' } },
      params: { organizationId: 'org-1' },
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await requireOrganizationRole(['admin'])(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('denies a viewer access to admin-only organization routes', async () => {
    vi.mocked(membershipsRepository.findForUserInOrganization).mockResolvedValue({
      _id: 'membership-2',
      organizationId: 'org-1',
      userId: 'user-2',
      role: 'viewer',
      groupIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const req = {
      authSession: { user: { id: 'user-2' } },
      params: { organizationId: 'org-1' },
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await requireOrganizationRole(['admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
