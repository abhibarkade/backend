import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InMemoryCacheService } from '../../../cache/in-memory-cache.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly cache: InMemoryCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_PUBLIC_KEY')!.replace(/\\n/g, '\n'),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtPayload) {
    const blacklisted = await this.cache.get(`jti_blacklist:${payload.jti}`);
    if (blacklisted) {
      throw new UnauthorizedException('Token has been revoked.');
    }
    return { userId: payload.sub, email: payload.email, role: payload.role, jti: payload.jti };
  }
}
