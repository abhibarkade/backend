import { IsString, IsEnum, IsUrl, IsOptional, MinLength, MaxLength, ValidateIf } from 'class-validator';

export class CreateAnalysisDto {
  @IsEnum(['paste', 'link'])
  inputMode: 'paste' | 'link';

  @ValidateIf((o) => o.inputMode === 'paste')
  @IsString()
  @MinLength(60)
  @MaxLength(20000)
  jdText?: string;

  @ValidateIf((o) => o.inputMode === 'link')
  @IsUrl({ protocols: ['https'] })
  jdUrl?: string;
}
