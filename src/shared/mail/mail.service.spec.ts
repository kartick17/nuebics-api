import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';
import { validateEnv } from '../../config/env.validation';

jest.mock('nodemailer');

const sendMail = jest.fn();
(nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

function baseEnv() {
  process.env.CRYPTO_SECRET ||= 'a'.repeat(64);
  process.env.JWT_ACCESS_SECRET ||= 'b'.repeat(64);
  process.env.JWT_REFRESH_SECRET ||= 'c'.repeat(64);
  process.env.MONGODB_URI ||= 'mongodb://localhost/test';
  process.env.AWS_ACCESS_KEY_ID ||= 'x';
  process.env.AWS_SECRET_ACCESS_KEY ||= 'x';
  process.env.AWS_REGION ||= 'x';
  process.env.AWS_S3_BUCKET_NAME ||= 'x';
  process.env.CRON_SECRET ||= 'x';
}

async function buildService(): Promise<MailService> {
  const mod = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnv
      })
    ],
    providers: [MailService]
  }).compile();
  return mod.get(MailService);
}

describe('MailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    baseEnv();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  describe('when SMTP is configured', () => {
    beforeEach(() => {
      process.env.SMTP_HOST = 'smtp.test';
      process.env.SMTP_USER = 'user';
      process.env.SMTP_PASS = 'pass';
    });

    it('sends the OTP email through the transport', async () => {
      sendMail.mockResolvedValueOnce({});
      const service = await buildService();

      await service.sendOtp('to@test.com', '123456', 'Alice');

      expect(sendMail).toHaveBeenCalledTimes(1);
      const calls = sendMail.mock.calls as Array<
        [{ to: string; subject: string; html: string }]
      >;
      const arg = calls[0][0];
      expect(arg.to).toBe('to@test.com');
      expect(arg.subject).toContain('verification code');
      expect(arg.html).toContain('123456');
      expect(arg.html).toContain('Alice');
    });

    it('does not throw when the transport fails', async () => {
      sendMail.mockRejectedValueOnce(new Error('smtp down'));
      const service = await buildService();

      await expect(
        service.sendOtp('to@test.com', '123456')
      ).resolves.toBeUndefined();
    });
  });

  describe('when SMTP is not configured', () => {
    it('skips sending and does not build a transport', async () => {
      const service = await buildService();

      await service.sendOtp('to@test.com', '123456');

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
