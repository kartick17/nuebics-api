import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../shared/database/schemas/user.schema';
import { CryptoService } from '../shared/crypto/crypto.service';

@Injectable()
export class VaultPasswordService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly crypto: CryptoService,
  ) {}

  async getVerifier(userId: string): Promise<string> {
    const user = await this.userModel.findById(userId).select('vaultCredentialVerifier');
    if (!user) throw new NotFoundException('User not found.');
    if (!user.vaultCredentialVerifier) throw new NotFoundException('No vault password set.');
    const verifier = this.crypto.decryptToken(user.vaultCredentialVerifier);
    if (!verifier) throw new InternalServerErrorException('Vault password corrupted.');
    return verifier;
  }

  async setVerifier(userId: string, encryptedToken: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.vaultCredentialVerifier) {
      const credentialChecker = this.crypto.decryptToken(user.vaultCredentialVerifier);
      return { alreadySet: true as const, credentialChecker };
    }
    user.vaultCredentialVerifier = this.crypto.encryptToken(encryptedToken);
    await user.save();
    return { alreadySet: false as const, user };
  }
}
