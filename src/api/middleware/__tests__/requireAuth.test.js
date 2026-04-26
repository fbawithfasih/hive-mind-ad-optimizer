// Mock Prisma before importing requireAuth (which imports prisma.ts)
jest.mock('../../../db/prisma.js', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

import jwt from 'jsonwebtoken';
import { requireAuth } from '../requireAuth.js';
import { prisma }      from '../../../db/prisma.js';

// Default: user exists in DB
beforeEach(() => {
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1', email: 'test@example.com', firstName: 'Test', lastName: 'User',
  });
});

describe('requireAuth middleware', () => {
  const JWT_SECRET = process.env.SESSION_SECRET || 'test-secret';
  const COOKIE_NAME = 'hmn_token';

  // Helper function to create valid JWT token
  const createToken = (payload, secret = JWT_SECRET, expiresIn = '8h') => {
    return jwt.sign(payload, secret, { expiresIn });
  };

  // Mock Express request/response/next
  const mockRequest = () => ({
    cookies: {},
  });

  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNext = jest.fn();
    // Default: user found in DB
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'test@example.com', firstName: 'Test', lastName: 'User',
    });
  });

  describe('Valid Authentication', () => {
    it('should allow request with valid JWT', async () => {
      const req = mockRequest();
      const res = mockResponse();
      req.cookies[COOKIE_NAME] = createToken({ userId: 'user-1', email: 'test@example.com' });

      await requireAuth(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.user).toEqual(expect.objectContaining({ email: 'test@example.com' }));
    });

    it('should extract user email from token', async () => {
      const req = mockRequest();
      const res = mockResponse();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2', email: 'user@company.com', firstName: 'User', lastName: 'Two',
      });
      req.cookies[COOKIE_NAME] = createToken({ userId: 'user-2', email: 'user@company.com' });

      await requireAuth(req, res, mockNext);

      expect(req.user.email).toBe('user@company.com');
    });

    it('should return 401 when user no longer exists in DB', async () => {
      const req = mockRequest();
      const res = mockResponse();
      req.cookies[COOKIE_NAME] = createToken({ userId: 'deleted-user', email: 'gone@example.com' });
      prisma.user.findUnique.mockResolvedValue(null);

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Missing Token', () => {
    it('should reject request without cookie', async () => {
      const req = mockRequest();
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with undefined cookies', async () => {
      const req = { cookies: undefined };
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with null cookies', async () => {
      const req = { cookies: null };
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject empty string token', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = '';
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject when only a different cookie is present', async () => {
      const req = mockRequest();
      req.cookies = { other_cookie: 'value' };
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Expired Token', () => {
    it('should reject expired token', async () => {
      const req = mockRequest();
      const res = mockResponse();
      // nbf trick: sign with iat in the past and expiresIn=0
      const token = jwt.sign(
        { userId: 'user-1', email: 'test@example.com', iat: Math.floor(Date.now() / 1000) - 100 },
        JWT_SECRET,
        { expiresIn: 1 }  // 1 second — already expired given iat
      );
      // Manually back-date by rewriting iat to ensure expiry
      const expiredToken = jwt.sign(
        { userId: 'user-1', email: 'test@example.com' },
        JWT_SECRET,
        { expiresIn: -1 }
      );
      req.cookies[COOKIE_NAME] = expiredToken;

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Invalid Token', () => {
    it('should reject malformed token', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = 'not.a.valid.token';
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject token with wrong signature', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = createToken({ userId: 'user-1', email: 'test@example.com' }, 'wrong-secret');
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject garbled token', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = 'abc123xyz';
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject plain JSON as token', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = '{"email":"test@example.com"}';
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Security', () => {
    it('should not expose internal error details', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = 'invalid-token';
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      const errorResponse = res.json.mock.calls[0][0];
      expect(errorResponse.details).toBeUndefined();
      expect(errorResponse.stack).toBeUndefined();
    });

    it('should reject token signed with different secret', async () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = jwt.sign({ userId: 'user-1', email: 'x@y.com' }, 'different-secret', { expiresIn: '8h' });
      const res = mockResponse();

      await requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Integration', () => {
    it('should work with multiple sequential requests', async () => {
      const token = createToken({ userId: 'user-1', email: 'test@example.com' });

      const req1 = mockRequest();
      req1.cookies[COOKIE_NAME] = token;
      await requireAuth(req1, mockResponse(), mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(req1.user.email).toBe('test@example.com');

      jest.clearAllMocks();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com', firstName: 'T', lastName: 'U' });
      mockNext = jest.fn();
      const req2 = mockRequest();
      req2.cookies[COOKIE_NAME] = token;
      await requireAuth(req2, mockResponse(), mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(req2.user.email).toBe('test@example.com');
    });
  });
});
