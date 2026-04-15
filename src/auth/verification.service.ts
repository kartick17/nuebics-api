import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../shared/database/schemas/user.schema';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

@Injectable()
export class VerificationService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async getEmailStatus(userId: string) {
    const user = await this.userModel.findById(userId).select('email isEmailVerified');
    if (!user) throw new NotFoundException('User not found.');
    return { email: user.email, isVerified: user.isEmailVerified || false };
  }

  async verifyEmail(userId: string, code: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.isEmailVerified) return { user, already: true };
    if (!user.emailVerificationCode) throw new BadRequestException('No verification code found.');
    if (user.emailVerificationCode !== code) throw new BadRequestException('Invalid verification code.');
    user.isEmailVerified = true;
    user.emailVerificationCode = null;
    await user.save();
    return { user, already: false };
  }

  async getPhoneStatus(userId: string) {
    const user = await this.userModel.findById(userId).select('phone isPhoneVerified');
    if (!user) throw new NotFoundException('User not found.');
    return { phone: user.phone, isVerified: user.isPhoneVerified || false };
  }

  async verifyPhone(userId: string, code: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.isPhoneVerified) return { user, already: true };
    if (!user.phoneVerificationCode) throw new BadRequestException('No OTP found.');
    if (user.phoneVerificationCode !== code) throw new BadRequestException('Invalid OTP.');
    user.isPhoneVerified = true;
    user.phoneVerificationCode = null;
    await user.save();
    return { user, already: false };
  }

  async resendOtp(userId: string, channel: 'email' | 'phone') {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    if (channel === 'email') {
      if (!user.email) throw new BadRequestException('No email on account.');
      if (user.isEmailVerified) return { already: true };
      user.emailVerificationCode = generateOTP();
      user.emailVerificationExpires = expiry;
    } else {
      if (!user.phone) throw new BadRequestException('No phone on account.');
      if (user.isPhoneVerified) return { already: true };
      user.phoneVerificationCode = generateOTP();
      user.phoneVerificationExpires = expiry;
    }
    await user.save();
    return { already: false };
  }
}
