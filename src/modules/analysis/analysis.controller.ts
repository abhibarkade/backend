import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import type { Request } from 'express';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { ParseFilePipe } from '../../common/pipes/parse-file.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  // @Public() lets anonymous requests through the global JwtAuthGuard.
  // req.user will be populated if a valid Bearer token is provided (Passport attaches it via jwt.strategy).
  @Public()
  @Post()
  @UseInterceptors(FileInterceptor('resume', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @UploadedFile(ParseFilePipe) file: Express.Multer.File,
    @Body() dto: CreateAnalysisDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as { userId: string } | undefined;
    return this.analysisService.create(file, dto, user?.userId);
  }

  @Public()
  @Get(':jobId')
  getByJobId(@Param('jobId') jobId: string) {
    return this.analysisService.getByJobId(jobId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  list(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
  ) {
    return this.analysisService.listForUser(user.userId, Number(page), Number(limit), status);
  }
}
