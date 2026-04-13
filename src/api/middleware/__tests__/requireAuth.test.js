/**
 * Test suite for authentication middleware
 * Validates JWT validation and session handling
 */

import jwt from 'jsonwebtoken';
import { requireAuth } from '../requireAuth.js';

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

  const mockNext = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Valid Authentication', () => {
    it('should allow request with valid JWT', () => {
      const req = mockRequest();
      const res = mockResponse();
      const token = createToken({ email: 'test@example.com' });
      req.cookies[COOKIE_NAME] = token;

      requireAuth(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.user).toEqual(expect.objectContaining({ email: 'test@example.com' }));
    });

    it('should extract user email from token', () => {
      const req = mockRequest();
      const res = mockResponse();
      const token = createToken({ email: 'user@company.com' });
      req.cookies[COOKIE_NAME] = token;

      requireAuth(req, res, mockNext);

      expect(req.user.email).toBe('user@company.com');
    });

    it('should handle custom payload properties', () => {
      const req = mockRequest();
      const res = mockResponse();
      const token = createToken({
        email: 'test@example.com',
        userId: '12345',
        role: 'admin',
      });
      req.cookies[COOKIE_NAME] = token;

      requireAuth(req, res, mockNext);

      expect(req.user).toEqual(
        expect.objectContaining({
          email: 'test@example.com',
          userId: '12345',
          role: 'admin',
        })
      );
    });
  });

  describe('Missing Token', () => {
    it('should reject request without cookie', () => {
      const req = mockRequest();
      const res = mockResponse();

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with empty cookie object', () => {
      const req = mockRequest();
      req.cookies = undefined;
      const res = mockResponse();

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with null cookies', () => {
      const req = mockRequest();
      req.cookies = null;
      const res = mockResponse();

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Expired Token', () => {
    it('should reject expired token', () => {
      const req = mockRequest();
      const res = mockResponse();
      // Create token that expires immediately
      const token = createToken({ email: 'test@example.com' }, JWT_SECRET, '0s');
      // Wait a bit to ensure expiration
      req.cookies[COOKIE_NAME] = token;

      setTimeout(() => {
        requireAuth(req, res, mockNext);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Session expired — please log in again',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      }, 100);
    });
  });

  describe('Invalid Token', () => {
    it('should reject malformed token', () => {
      const req = mockRequest();
      const res = mockResponse();
      req.cookies[COOKIE_NAME] = 'not.a.valid.token';

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Session expired — please log in again',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject token with wrong signature', () => {
      const req = mockRequest();
      const res = mockResponse();
      // Create token with different secret
      const token = createToken({ email: 'test@example.com' }, 'wrong-secret');
      req.cookies[COOKIE_NAME] = token;

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject garbled token', () => {
      const req = mockRequest();
      const res = mockResponse();
      req.cookies[COOKIE_NAME] = 'abc123xyz';

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject token with wrong format', () => {
      const req = mockRequest();
      const res = mockResponse();
      req.cookies[COOKIE_NAME] = '{"email":"test@example.com"}'; // JSON, not JWT

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Security', () => {
    it('should not allow token from different issuer', () => {
      const req = mockRequest();
      const res = mockResponse();
      const token = jwt.sign(
        { email: 'test@example.com' },
        'different-secret', // Different secret = different issuer
        { expiresIn: '8h' }
      );
      req.cookies[COOKIE_NAME] = token;

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should validate token format strictly', () => {
      const req = mockRequest();
      const res = mockResponse();
      // Token-like but invalid structure
      req.cookies[COOKIE_NAME] =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should not expose internal error details', () => {
      const req = mockRequest();
      const res = mockResponse();
      req.cookies[COOKIE_NAME] = 'invalid-token';

      requireAuth(req, res, mockNext);

      const errorResponse = res.json.mock.calls[0][0];
      expect(errorResponse.error).toBe('Session expired — please log in again');
      expect(errorResponse.details).toBeUndefined();
      expect(errorResponse.stack).toBeUndefined();
    });
  });

  describe('Cookie Handling', () => {
    it('should handle undefined cookies gracefully', () => {
      const req = { cookies: undefined };
      const res = mockResponse();

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should handle missing specific cookie', () => {
      const req = mockRequest();
      req.cookies = { other_cookie: 'value' };
      const res = mockResponse();

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should handle empty string token', () => {
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = '';
      const res = mockResponse();

      requireAuth(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Integration', () => {
    it('should work with multiple sequential requests', () => {
      const token = createToken({ email: 'test@example.com' });

      // First request
      const req1 = mockRequest();
      req1.cookies[COOKIE_NAME] = token;
      const res1 = mockResponse();
      requireAuth(req1, res1, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req1.user.email).toBe('test@example.com');

      // Second request
      jest.clearAllMocks();
      const req2 = mockRequest();
      req2.cookies[COOKIE_NAME] = token;
      const res2 = mockResponse();
      requireAuth(req2, res2, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(req2.user.email).toBe('test@example.com');
    });

    it('should work with standard Express middleware chain', () => {
      const token = createToken({ email: 'admin@company.com' });
      const req = mockRequest();
      req.cookies[COOKIE_NAME] = token;
      const res = mockResponse();
      const next = jest.fn();

      // Simulates middleware chain
      requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });
  });
});
