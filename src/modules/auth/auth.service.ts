import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { InMemoryCacheService } from '../../cache/in-memory-cache.service';

const VALID_PROVIDERS = ['google', 'github', 'facebook', 'apple'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly cache: InMemoryCacheService,
  ) {}

  validateProvider(provider: string): void {
    if (!VALID_PROVIDERS.includes(provider)) {
      throw new BadRequestException(`Unknown provider: ${provider}`);
    }
  }

  async generateCsrfState(): Promise<string> {
    const state = crypto.randomUUID();
    await this.cache.set(`csrf:${state}`, '1', 'EX', 300);
    return state;
  }

  async validateCsrfState(state: string): Promise<void> {
    const exists = await this.cache.get(`csrf:${state}`);
    if (!exists) throw new BadRequestException('Invalid or expired CSRF state.');
    await this.cache.del(`csrf:${state}`);
  }

  async handleOAuthCallback(providerUser: {
    provider: string;
    providerUserId: string;
    email: string;
    fullName: string;
    avatarUrl?: string | null;
  }) {
    const { provider, providerUserId, email, fullName, avatarUrl } = providerUser;

    let oauthAccount = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider: provider as any, providerUserId } },
      include: { user: true },
    });

    let user = oauthAccount?.user ?? null;

    if (!user) {
      if (email) {
        user = await this.prisma.user.findUnique({ where: { email } });
      }
      if (!user) {
        user = await this.prisma.user.create({
          data: { email: email || `${providerUserId}@${provider}.oauth`, fullName, avatarUrl },
        });
      }
      await this.prisma.oAuthAccount.create({
        data: { userId: user.id, provider: provider as any, providerUserId, providerEmail: email },
      });
    }

    return this.issueTokens(user.id, user.email, user.role);
  }

  async issueTokens(userId: string, email: string, role: string) {
    const jti = crypto.randomUUID();
    const accessTtl = this.config.get<number>('JWT_ACCESS_TOKEN_TTL', 900);
    const refreshTtl = this.config.get<number>('JWT_REFRESH_TOKEN_TTL', 2592000);

    const accessToken = this.jwtService.sign(
      { sub: userId, email, role, jti },
      { expiresIn: accessTtl },
    );

    const refreshToken = crypto.randomUUID();
    await this.cache.set(`refresh:${refreshToken}`, userId, 'EX', refreshTtl);

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  async refreshTokens(oldRefreshToken: string) {
    const userId = await this.cache.get(`refresh:${oldRefreshToken}`);
    if (!userId) throw new UnauthorizedException('Session expired. Please log in again.');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Account not found.');

    const refreshTtl = this.config.get<number>('JWT_REFRESH_TOKEN_TTL', 2592000);
    const newRefreshToken = crypto.randomUUID();

    const pipeline = this.cache.pipeline();
    pipeline.del(`refresh:${oldRefreshToken}`);
    pipeline.set(`refresh:${newRefreshToken}`, userId, 'EX', refreshTtl);
    await pipeline.exec();

    return this.issueTokens(user.id, user.email, user.role).then((tokens) => ({
      ...tokens,
      refreshToken: newRefreshToken,
    }));
  }

  async logout(refreshToken: string, jti: string) {
    const accessTtl = this.config.get<number>('JWT_ACCESS_TOKEN_TTL', 900);
    const pipeline = this.cache.pipeline();
    pipeline.del(`refresh:${refreshToken}`);
    pipeline.set(`jti_blacklist:${jti}`, '1', 'EX', accessTtl);
    await pipeline.exec();
  }
}
