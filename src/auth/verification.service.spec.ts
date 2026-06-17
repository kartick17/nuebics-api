import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { VerificationService } from './verification.service';
import { User } from '../shared/database/schemas/user.schema';
import { MailService } from '../shared/mail/mail.service';

type FakeUser = {
  email: string | null;
  phone: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  emailVerificationCode: string | null;
  emailVerificationExpires: Date | null;
  phoneVerificationCode: string | null;
  phoneVerificationExpires: Date | null;
  save: jest.Mock;
};

const MINUTE = 60 * 1000;

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    email: 'a@test.com',
    phone: '+10000000000',
    isEmailVerified: false,
    isPhoneVerified: false,
    emailVerificationCode: '123456',
    emailVerificationExpires: new Date(Date.now() + 10 * MINUTE),
    phoneVerificationCode: '654321',
    phoneVerificationExpires: new Date(Date.now() + 10 * MINUTE),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('VerificationService — OTP expiry', () => {
  let service: VerificationService;
  const findById = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: getModelToken(User.name), useValue: { findById } },
        { provide: MailService, useValue: { sendOtp: jest.fn() } }
      ]
    }).compile();
    service = mod.get(VerificationService);
  });

  describe('verifyEmail', () => {
    it('rejects an expired code without verifying', async () => {
      const user = makeUser({
        emailVerificationExpires: new Date(Date.now() - MINUTE)
      });
      findById.mockResolvedValue(user);

      await expect(service.verifyEmail('id', '123456')).rejects.toThrow(
        BadRequestException
      );
      expect(user.isEmailVerified).toBe(false);
      expect(user.save).not.toHaveBeenCalled();
    });

    it('accepts a code that has not expired', async () => {
      const user = makeUser();
      findById.mockResolvedValue(user);

      const res = await service.verifyEmail('id', '123456');

      expect(res.already).toBe(false);
      expect(user.isEmailVerified).toBe(true);
      expect(user.emailVerificationCode).toBeNull();
      expect(user.save).toHaveBeenCalledTimes(1);
    });

    it('checks expiry before the code value (expired wins)', async () => {
      const user = makeUser({
        emailVerificationExpires: new Date(Date.now() - MINUTE)
      });
      findById.mockResolvedValue(user);

      await expect(service.verifyEmail('id', 'wrong')).rejects.toThrow(
        /expired/i
      );
    });
  });

  describe('verifyPhone', () => {
    it('rejects an expired OTP without verifying', async () => {
      const user = makeUser({
        phoneVerificationExpires: new Date(Date.now() - MINUTE)
      });
      findById.mockResolvedValue(user);

      await expect(service.verifyPhone('id', '654321')).rejects.toThrow(
        /expired/i
      );
      expect(user.isPhoneVerified).toBe(false);
      expect(user.save).not.toHaveBeenCalled();
    });

    it('accepts an OTP that has not expired', async () => {
      const user = makeUser();
      findById.mockResolvedValue(user);

      const res = await service.verifyPhone('id', '654321');

      expect(res.already).toBe(false);
      expect(user.isPhoneVerified).toBe(true);
      expect(user.save).toHaveBeenCalledTimes(1);
    });
  });
});
