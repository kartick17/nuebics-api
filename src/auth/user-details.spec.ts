import { toUserDetails } from './user-details';

describe('toUserDetails', () => {
  it('returns the safe user payload with vault boolean', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const user: any = {
      _id: 'abc',
      name: 'Alice',
      email: 'a@b.com',
      phone: null,
      isEmailVerified: true,
      isPhoneVerified: false,
      vaultCredentialVerifier: 'ciphertext',
      createdAt
    };
    expect(toUserDetails(user)).toEqual({
      id: 'abc',
      name: 'Alice',
      email: 'a@b.com',
      phone: null,
      isEmailVerified: true,
      isPhoneVerified: false,
      vaultCredentialVerifier: true,
      createdAt
    });
  });

  it('maps empty/missing vault credential to false', () => {
    const user: any = { _id: 'x', name: 'x', vaultCredentialVerifier: '' };
    expect(toUserDetails(user).vaultCredentialVerifier).toBe(false);

    const user2: any = { _id: 'y', name: 'y' };
    expect(toUserDetails(user2).vaultCredentialVerifier).toBe(false);
  });

  it('coerces ObjectId-like _id to string', () => {
    const _id = { toString: () => '507f1f77bcf86cd799439011' };
    const user: any = { _id, name: 'n', vaultCredentialVerifier: '' };
    expect(toUserDetails(user).id).toBe('507f1f77bcf86cd799439011');
  });

  it('defaults missing email/phone to null', () => {
    const user: any = { _id: 'z', name: 'z', vaultCredentialVerifier: '' };
    const out = toUserDetails(user);
    expect(out.email).toBeNull();
    expect(out.phone).toBeNull();
  });

  it('does not leak passwordHash, OTP codes, or raw vault ciphertext', () => {
    const user: any = {
      _id: 'a',
      name: 'a',
      passwordHash: 'secret-hash',
      emailVerificationCode: '123456',
      emailVerificationExpires: new Date(),
      phoneVerificationCode: '654321',
      phoneVerificationExpires: new Date(),
      vaultCredentialVerifier: 'cipher'
    };
    const out: any = toUserDetails(user);
    expect(out.passwordHash).toBeUndefined();
    expect(out.emailVerificationCode).toBeUndefined();
    expect(out.emailVerificationExpires).toBeUndefined();
    expect(out.phoneVerificationCode).toBeUndefined();
    expect(out.phoneVerificationExpires).toBeUndefined();
    // vaultCredentialVerifier exposed only as boolean
    expect(out.vaultCredentialVerifier).toBe(true);
  });

  it('emits exactly the documented fields — no extras', () => {
    const user: any = {
      _id: 'a',
      name: 'a',
      email: 'e@x.com',
      phone: null,
      isEmailVerified: false,
      isPhoneVerified: false,
      vaultCredentialVerifier: 'cipher',
      createdAt: new Date(),
      passwordHash: 'secret',
      emailVerificationCode: '111',
      emailVerificationExpires: new Date(),
      phoneVerificationCode: '222',
      phoneVerificationExpires: new Date()
    };
    const out = toUserDetails(user);
    expect(Object.keys(out).sort()).toEqual(
      [
        'createdAt',
        'email',
        'id',
        'isEmailVerified',
        'isPhoneVerified',
        'name',
        'phone',
        'vaultCredentialVerifier'
      ].sort()
    );
  });
});
