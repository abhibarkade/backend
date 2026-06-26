import { Controller, Get, Put, Delete, Param, Body, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { HistoryService } from './history.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class TagDto {
  @IsString() @MaxLength(100) label: string;
  @IsEnum(['sage', 'clay', 'amber']) variant: 'sage' | 'clay' | 'amber';
}

class UpdateHistoryDto {
  @IsOptional() @IsEnum(['not_applied', 'applied', 'interviewing', 'offer', 'rejected'])
  status?: string;

  @IsOptional() @ValidateNested() @Type(() => TagDto)
  tag?: TagDto;
}

@ApiTags('history')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.historyService.list(user.userId, Number(page), Number(limit), status, q);
  }

  @Put(':id')
  update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateHistoryDto) {
    return this.historyService.update(id, user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.historyService.remove(id, user.userId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAll(@CurrentUser() user: any) {
    return this.historyService.removeAll(user.userId);
  }
}
