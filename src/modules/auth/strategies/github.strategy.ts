import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.get<string>('GITHUB_CLIENT_ID') || 'placeholder',
      clientSecret: config.get<string>('GITHUB_CLIENT_SECRET') || 'placeholder',
      callbackURL: config.get<string>('GITHUB_CALLBACK_URL') || 'http://localhost:3001/api/auth/github/callback',
      scope: ['read:user', 'user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user?: any) => void,
  ) {
    const email = profile.emails?.[0]?.value ?? null;
    const user = {
      providerUserId: String(profile.id),
      email,
      fullName: profile.displayName || profile.username || '',
      avatarUrl: profile.photos?.[0]?.value ?? null,
      provider: 'github',
    };
    done(null, user);
  }
}
