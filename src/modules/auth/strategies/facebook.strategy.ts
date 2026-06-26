import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.get<string>('FACEBOOK_APP_ID') || 'placeholder',
      clientSecret: config.get<string>('FACEBOOK_APP_SECRET') || 'placeholder',
      callbackURL: config.get<string>('FACEBOOK_CALLBACK_URL') || 'http://localhost:3001/api/auth/facebook/callback',
      scope: ['email', 'public_profile'],
      profileFields: ['id', 'emails', 'name', 'picture'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user?: any) => void,
  ) {
    const user = {
      providerUserId: String(profile.id),
      email: profile.emails?.[0]?.value ?? null,
      fullName: `${profile.name?.givenName ?? ''} ${profile.name?.familyName ?? ''}`.trim(),
      avatarUrl: profile.photos?.[0]?.value ?? null,
      provider: 'facebook',
    };
    done(null, user);
  }
}
