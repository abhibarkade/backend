export interface AnalysisResult {
  roleTitle: string;
  company: string;
  location: string;
  source: string;
  overallScore: number;
  stats: {
    strongMatches: number;
    gapsFound: number;
    atsCoverage: number;
  };
  issues: {
    id: string;
    variant: 'clay' | 'amber';
    tag: string;
    headline: string;
    description: string;
    priority: number;
    action: string;
  }[];
  keywords: {
    label: string;
    status: 'have' | 'missing';
  }[];
  rewrites: {
    before: string;
    after: string;
  }[];
}

export interface ILlmService {
  analyze(resumeText: string, jdText: string): Promise<AnalysisResult>;
}

export const LLM_SERVICE = 'LLM_SERVICE';
