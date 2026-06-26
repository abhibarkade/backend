import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get(':provider/authorize')
  async authorize(@Param('provider') provider: string) {
    this.authService.validateProvider(provider);
    const state = await this.authService.generateCsrfState();
    // The actual authorization URL is built by Passport — this endpoint generates state
    // and returns it so the frontend can redirect using the provider-specific URL
    const providerUpper = provider.toUpperCase();
    const callbackUrl = this.config.get<string>(`${providerUpper}_CALLBACK_URL`) || '';
    const clientId = this.config.get<string>(`${providerUpper}_CLIENT_ID`) || '';
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    return { authUrl: `/api/auth/${provider}/start?state=${state}`, state };
  }

  @Public()
  @Get(':provider/start')
  @UseGuards(AuthGuard('google'))
  startOAuth() {
    // Passport redirects automatically
  }

  @Public()
  @Get(':provider/callback')
  @UseGuards(AuthGuard('google'))
  async oauthCallback(
    @Param('provider') _provider: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (state) {
      await this.authService.validateCsrfState(state).catch(() => null);
    }

    const providerUser = (req as any).user as any;
    const { accessToken, refreshToken, expiresIn } = await this.authService.handleOAuthCallback(providerUser);

    const refreshTtl = this.config.get<number>('JWT_REFRESH_TOKEN_TTL', 2592000);
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: refreshTtl * 1000,
    });

    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    return res.redirect(`${frontendUrl}/auth/callback?access_token=${accessToken}&expires_in=${expiresIn}`);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const oldToken = (req as any).cookies?.['refresh_token'];
    if (!oldToken) throw new UnauthorizedException('No refresh token provided.');

    const { accessToken, refreshToken, expiresIn } = await this.authService.refreshTokens(oldToken);

    const refreshTtl = this.config.get<number>('JWT_REFRESH_TOKEN_TTL', 2592000);
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: refreshTtl * 1000,
    });

    return { access_token: accessToken, expires_in: expiresIn };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: any,
  ) {
    const refreshToken = (req as any).cookies?.['refresh_token'];
    if (refreshToken) {
      await this.authService.logout(refreshToken, user.jti);
    }
    res.clearCookie('refresh_token', { path: '/api/auth' });
  }
}
