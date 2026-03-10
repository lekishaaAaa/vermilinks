const { requireOtpVerified } = require('../middleware/auth');

function createResponseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('requireOtpVerified', () => {
  test('allows admin request when session metadata contains otpVerifiedAt', () => {
    const req = {
      user: { role: 'admin' },
      session: {
        metadata: {
          otpVerifiedAt: new Date().toISOString(),
        },
      },
    };
    const res = createResponseDouble();
    const next = jest.fn();

    requireOtpVerified(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('allows admin request when token came from admin OTP flow', () => {
    const req = {
      user: { role: 'admin' },
      authTokenPayload: {
        role: 'admin',
        email: 'admin@example.com',
      },
    };
    const res = createResponseDouble();
    const next = jest.fn();

    requireOtpVerified(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects admin request without OTP session or OTP-backed admin token', () => {
    const req = {
      user: { role: 'admin' },
      authTokenPayload: {
        role: 'admin',
        username: 'legacy-admin',
      },
    };
    const res = createResponseDouble();
    const next = jest.fn();

    requireOtpVerified(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'OTP verification required.',
    });
  });
});