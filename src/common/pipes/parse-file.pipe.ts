import { PipeTransform, Injectable, BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class ParseFilePipe implements PipeTransform {
  async transform(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Resume file is required.');
    }

    if (file.size > MAX_SIZE) {
      throw new BadRequestException('File size must not exceed 10 MB.');
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime)) {
      throw new UnsupportedMediaTypeException('Only PDF and DOCX files are accepted.');
    }

    return file;
  }
}
