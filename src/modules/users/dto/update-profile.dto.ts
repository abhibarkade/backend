import { IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @Length(1, 255)
  fullName: string;
}
