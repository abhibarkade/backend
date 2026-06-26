import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // For @Public() routes: try to authenticate silently (to populate req.user for optional-auth endpoints).
      // Even if it fails (no token / bad token), let the request through with req.user = null.
      try {
        await super.canActivate(context);
      } catch {
        // No token or invalid token — that's fine for public routes
      }
      return true;
    }

    // Protected route: full JWT enforcement
    return super.canActivate(context) as Promise<boolean>;
  }
}
