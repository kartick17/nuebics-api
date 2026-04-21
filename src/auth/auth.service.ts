import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { User, UserDocument } from '../shared/database/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from '../shared/database/schemas/refresh-token.schema';
import {
  CryptoService,
  REFRESH_TOKEN_SECONDS,
} from '../shared/crypto/crypto.service';
import type { SignupInput } from './dto/signup.schema';
import type { LoginInput } from './dto/login.schema';

const DUMMY_HASH =
  '$2b$12$invalidhashfortimingprotection000000000000000000000000';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly crypto: CryptoService,
  ) {}

  async signup(input: SignupInput): Promise<void> {
    const { name, email, phone, password } = input;

    if (
      email &&
      (await this.userModel.exists({ email: email.toLowerCase() }))
    ) {
      throw new ConflictException('Email is already in use');
    }
    if (phone && (await this.userModel.exists({ phone }))) {
      throw new ConflictException('Phone number is already in use');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    const emailOTP = generateOTP();
    const phoneOTP = generateOTP();

    await this.userModel.create({
      name,
      email: email || undefined,
      phone: phone || undefined,
      passwordHash,
      emailVerificationCode: email ? emailOTP : null,
      emailVerificationExpires: email ? expiry : null,
      phoneVerificationCode: phone ? phoneOTP : null,
      phoneVerificationExpires: phone ? expiry : null,
    });
  }

  async login(input: LoginInput): Promise<{
    user: UserDocument;
    accessToken: string;
    refreshToken: string;
  }> {
    const { identifier, password } = input;
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await this.userModel.findOne({ email: identifier.toLowerCase() })
      : await this.userModel.findOne({ phone: identifier });

    const hash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');

    const sessionId = randomUUID();
    const accessToken = await this.crypto.signAccessToken(
      user._id.toString(),
      sessionId,
    );
    const refreshToken = await this.crypto.signRefreshToken(
      user._id.toString(),
      sessionId,
    );

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);
    await this.refreshTokenModel.updateOne(
      { sessionId },
      {
        $set: {
          sessionId,
          userId: user._id,
          tokenHash: hashToken(refreshToken),
          expiresAt,
        },
      },
      { upsert: true },
    );

    return { user, accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    const payload = await this.crypto.verifyRefreshToken(refreshToken);
    if (!payload) return null;
    const { userId, sessionId } = payload;

    const user = await this.userModel.findById(userId).select('-passwordHash');
    if (!user) return null;

    const newAccessToken = await this.crypto.signAccessToken(userId, sessionId);
    const newRefreshToken = await this.crypto.signRefreshToken(
      userId,
      sessionId,
    );
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);

    const swap = await this.refreshTokenModel.findOneAndUpdate(
      {
        sessionId,
        tokenHash: hashToken(refreshToken),
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          tokenHash: hashToken(newRefreshToken),
          expiresAt: newExpiresAt,
        },
      },
      { new: true },
    );

    if (!swap) return null;

    return { user, accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async me(userId: string) {
    const user = await this.userModel.findById(userId).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
