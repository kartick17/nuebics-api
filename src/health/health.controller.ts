import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  async check() {
    const mongoUp = this.connection.readyState === 1;
    if (!mongoUp) {
      throw new HttpException(
        { status: 'error', mongo: 'down', uptime: process.uptime() },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return {
      status: 'ok',
      mongo: 'up',
      uptime: process.uptime()
    };
  }
}
