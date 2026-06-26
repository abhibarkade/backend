import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import { parsePdf } from './pdf.parser';
import { parseDocx } from './docx.parser';

@Injectable()
export class ResumeParserService {
  async parse(buffer: Buffer, filename: string): Promise<string> {
    const detected = await fileTypeFromBuffer(buffer);
    const mime = detected?.mime;

    if (mime === 'application/pdf') {
      return parsePdf(buffer);
    }

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return parseDocx(buffer);
    }

    throw new UnsupportedMediaTypeException('Unsupported file type. Only PDF and DOCX are accepted.');
  }
}
