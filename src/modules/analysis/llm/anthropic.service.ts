import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ILlmService, AnalysisResult } from './llm.interface';
import { buildAnalysisPrompt } from './prompt';

@Injectable()
export class AnthropicService implements ILlmService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.get<string>('ANTHROPIC_API_KEY'),
      timeout: config.get<number>('LLM_REQUEST_TIMEOUT_MS', 60000),
    });
    this.model = config.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-6');
  }

  async analyze(resumeText: string, jdText: string): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(resumeText, jdText);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: 'You are an expert resume analyst. Return valid JSON only, no prose.',
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic');

    const text = block.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(text) as AnalysisResult;
  }
}
