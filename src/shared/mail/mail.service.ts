import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Env } from '../../config/env.validation';
import { otpEmailHtml } from './otp-email.template';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const host = this.config.get('SMTP_HOST', { infer: true });
    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASS', { infer: true });
    this.from =
      this.config.get('MAIL_FROM', { infer: true }) ??
      'Nuebics <no-reply@nuebics.com>';

    if (!host || !user || !pass) {
      this.transporter = null;
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing); OTP emails will not be sent.'
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      auth: { user, pass }
    });
  }

  /**
   * Send an OTP code by email. Never throws — failures are logged so callers
   * (signup, resend) stay non-blocking. No-ops when SMTP is not configured.
   */
  async sendOtp(to: string, code: string, name?: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Skipping OTP email to ${to}: SMTP not configured.`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Your Nuebics verification code',
        html: otpEmailHtml(code, name)
      });
    } catch (err) {
      this.logger.error(
        `Failed to send OTP email to ${to}`,
        err instanceof Error ? err.stack : String(err)
      );
    }
  }
}
