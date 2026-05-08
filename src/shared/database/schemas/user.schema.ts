import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'users'
})
export class User {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 60 })
  name: string;

  @Prop({
    required: true,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true
  })
  email: string;

  @Prop({ required: true, unique: true, sparse: true, trim: true })
  phone: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ default: false })
  isPhoneVerified: boolean;

  @Prop({ type: String, default: null })
  emailVerificationCode: string | null;

  @Prop({ type: Date, default: null })
  emailVerificationExpires: Date | null;

  @Prop({ type: String, default: null })
  phoneVerificationCode: string | null;

  @Prop({ type: Date, default: null })
  phoneVerificationExpires: Date | null;

  @Prop({ default: '' })
  vaultCredentialVerifier: string;

  createdAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
