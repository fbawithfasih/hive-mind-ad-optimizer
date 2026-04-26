import { requireRole } from '../requireRole.js';

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('requireRole factory', () => {
  it('throws for invalid role argument', () => {
    expect(() => requireRole('SUPERUSER')).toThrow(/invalid role/);
    expect(() => requireRole('')).toThrow();
    expect(() => requireRole(null)).toThrow();
  });

  it('accepts VIEWER, MEMBER, ADMIN', () => {
    expect(() => requireRole('VIEWER')).not.toThrow();
    expect(() => requireRole('MEMBER')).not.toThrow();
    expect(() => requireRole('ADMIN')).not.toThrow();
  });

  it('returns a middleware function', () => {
    expect(typeof requireRole('MEMBER')).toBe('function');
  });
});

describe('requireRole middleware', () => {
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  describe('missing tenant context', () => {
    it('returns 403 when req.tenant is absent', () => {
      const middleware = requireRole('VIEWER');
      const req = {};
      const res = makeRes();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when req.tenant.role is undefined', () => {
      const middleware = requireRole('VIEWER');
      const req = { tenant: {} };
      const res = makeRes();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('VIEWER minimum', () => {
    const middleware = requireRole('VIEWER');

    it('allows VIEWER', () => {
      const req = { tenant: { role: 'VIEWER' } };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('allows MEMBER', () => {
      const req = { tenant: { role: 'MEMBER' } };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('allows ADMIN', () => {
      const req = { tenant: { role: 'ADMIN' } };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('MEMBER minimum', () => {
    const middleware = requireRole('MEMBER');

    it('denies VIEWER', () => {
      const req = { tenant: { role: 'VIEWER' } };
      const res = makeRes();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows MEMBER', () => {
      const req = { tenant: { role: 'MEMBER' } };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('allows ADMIN', () => {
      const req = { tenant: { role: 'ADMIN' } };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('ADMIN minimum', () => {
    const middleware = requireRole('ADMIN');

    it('denies VIEWER', () => {
      const req = { tenant: { role: 'VIEWER' } };
      const res = makeRes();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('denies MEMBER', () => {
      const req = { tenant: { role: 'MEMBER' } };
      const res = makeRes();
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows ADMIN', () => {
      const req = { tenant: { role: 'ADMIN' } };
      middleware(req, makeRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('error message names both required and current role', () => {
      const req = { tenant: { role: 'VIEWER' } };
      const res = makeRes();
      middleware(req, res, next);
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.error).toMatch(/ADMIN/);
      expect(jsonArg.error).toMatch(/VIEWER/);
    });
  });
});
