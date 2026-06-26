import { Module } from '@nestjs/common';
import { DevAuthController } from './dev-auth.controller';
import { AuthModule } from '../auth.module';

@Module({
  imports: [AuthModule],
  controllers: [DevAuthController],
})
export class DevAuthModule {}
