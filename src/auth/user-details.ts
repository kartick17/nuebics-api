import type { UserDocument } from '../shared/database/schemas/user.schema';

export interface UserDetails {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  vaultCredentialVerifier: boolean;
  createdAt: Date;
}

export function toUserDetails(user: UserDocument): UserDetails {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email ?? null,
    phone: user.phone ?? null,
    isEmailVerified: !!user.isEmailVerified,
    isPhoneVerified: !!user.isPhoneVerified,
    vaultCredentialVerifier: !!user.vaultCredentialVerifier,
    createdAt: user.createdAt,
  };
}
