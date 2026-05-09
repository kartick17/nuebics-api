import { Global, Module } from '@nestjs/common';
import { StratusService } from './stratus.service';

@Global()
@Module({
  providers: [StratusService],
  exports: [StratusService]
})
export class StratusModule {}
