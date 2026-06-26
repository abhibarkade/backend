import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as any).requestId || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let errors: any[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (exceptionResponse.message) {
        if (Array.isArray(exceptionResponse.message)) {
          message = 'Validation failed';
          errors = exceptionResponse.message.map((msg: string) => ({ message: msg }));
        } else {
          message = exceptionResponse.message;
        }
      }

      if (status >= 400 && status < 500) {
        this.logger.warn(`${status} ${request.method} ${request.url} [${requestId}]: ${message}`);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'Resource already exists.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Not found.';
      }
      this.logger.warn(`Prisma ${exception.code} [${requestId}]: ${exception.message}`);
    } else {
      this.logger.error(`Unhandled exception [${requestId}]`, (exception as Error)?.stack);
    }

    const body: Record<string, any> = {
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    };

    if (errors) {
      body.errors = errors;
    }

    response.status(status).json(body);
  }
}
