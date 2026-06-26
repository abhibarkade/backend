import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ILlmService, AnalysisResult } from './llm.interface';
import { buildAnalysisPrompt } from './prompt';

@Injectable()
export class OpenAiService implements ILlmService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeout: number;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY'),
      timeout: config.get<number>('LLM_REQUEST_TIMEOUT_MS', 60000),
    });
    this.model = config.get<string>('OPENAI_MODEL', 'gpt-4o');
    this.timeout = config.get<number>('LLM_REQUEST_TIMEOUT_MS', 60000);
  }

  async analyze(resumeText: string, jdText: string): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(resumeText, jdText);

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenAI');

    return JSON.parse(content) as AnalysisResult;
  }
}
