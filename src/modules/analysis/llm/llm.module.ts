import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_SERVICE } from './llm.interface';
import { OpenAiService } from './openai.service';
import { AnthropicService } from './anthropic.service';

@Module({
  providers: [
    OpenAiService,
    AnthropicService,
    {
      provide: LLM_SERVICE,
      useFactory: (config: ConfigService, openai: OpenAiService, anthropic: AnthropicService) => {
        return config.get('LLM_PROVIDER') === 'anthropic' ? anthropic : openai;
      },
      inject: [ConfigService, OpenAiService, AnthropicService],
    },
  ],
  exports: [LLM_SERVICE],
})
export class LlmModule {}
