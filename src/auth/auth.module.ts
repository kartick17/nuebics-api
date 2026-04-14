import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { User, UserSchema } from '../shared/database/schemas/user.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [AuthService, CookieService],
})
export class AuthModule {}
