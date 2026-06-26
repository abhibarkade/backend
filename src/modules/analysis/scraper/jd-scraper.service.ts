import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';
import { promisify } from 'util';

const lookup = promisify(dns.lookup);

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

@Injectable()
export class JdScraperService {
  private readonly logger = new Logger(JdScraperService.name);

  async scrape(url: string): Promise<string> {
    await this.validateUrl(url);

    // Playwright is heavy — lazy import to avoid startup cost
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const text = await page.evaluate(() => document.body.innerText);
      return text.slice(0, 20000);
    } finally {
      await browser.close();
    }
  }

  private async validateUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid URL.');
    }

    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('Only HTTPS URLs are allowed.');
    }

    let address: string;
    try {
      const result = await lookup(parsed.hostname);
      address = result.address;
    } catch {
      throw new BadRequestException('Could not resolve hostname.');
    }

    for (const pattern of PRIVATE_RANGES) {
      if (pattern.test(address)) {
        throw new BadRequestException('URL resolves to a private address (SSRF protection).');
      }
    }
  }
}
