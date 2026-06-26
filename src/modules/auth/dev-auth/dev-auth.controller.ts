import { Controller, Post, Body, ForbiddenException } from '@nestjs/common';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Public } from '../decorators/public.decorator';

class DevLoginDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  fullName?: string;
}

export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';
export const DEV_USER_EMAIL = 'dev@tailor.test';
export const DEV_USER_NAME = 'Dev User';

@ApiTags('dev-auth')
@Controller('auth/dev')
export class DevAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  async devLogin(@Body() dto: DevLoginDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev login is not available in production.');
    }

    const email = dto.email || DEV_USER_EMAIL;
    const fullName = dto.fullName || DEV_USER_NAME;

    await this.prisma.user.upsert({
      where: { id: DEV_USER_ID },
      create: { id: DEV_USER_ID, email, fullName, role: 'user' },
      update: { email, fullName, deletedAt: null },
    });

    const tokens = await this.authService.issueTokens(DEV_USER_ID, email, 'user');

    return {
      userId: DEV_USER_ID,
      email,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    };
  }
}
