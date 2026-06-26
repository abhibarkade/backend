export const PROMPT_VERSION = process.env.LLM_PROMPT_VERSION || 'v1.0';

export function buildAnalysisPrompt(resumeText: string, jdText: string): string {
  return `You are an expert resume analyst and ATS specialist. Analyse the resume against the job description and return a JSON object ONLY — no prose, no markdown, no code fences.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}

Return this exact JSON structure:
{
  "roleTitle": "<job title from JD>",
  "company": "<company name from JD or 'Unknown'>",
  "location": "<location from JD or 'Not specified'>",
  "source": "Applied via paste",
  "overallScore": <integer 0-100>,
  "stats": {
    "strongMatches": <count of keywords/skills clearly present in resume>,
    "gapsFound": <count of critical missing keywords/skills>,
    "atsCoverage": <integer 0-100, ATS keyword match percentage>
  },
  "issues": [
    {
      "id": "issue-1",
      "variant": "clay",
      "tag": "critical",
      "headline": "<short issue title>",
      "description": "<2-3 sentence explanation>",
      "priority": 1,
      "action": "<one concrete action the candidate should take>"
    }
  ],
  "keywords": [
    { "label": "<keyword>", "status": "have" },
    { "label": "<missing keyword>", "status": "missing" }
  ],
  "rewrites": [
    {
      "before": "<original bullet from resume>",
      "after": "<improved version with metrics/impact>"
    }
  ]
}

Rules:
- issues: 3-6 items, sorted by priority (1 = most critical). variant is "clay" for critical/blocking issues, "amber" for improvements.
- keywords: 8-15 items total, mix of present and missing.
- rewrites: 2-4 items showing concrete improvements.
- overallScore: 70+ means strong fit. 55-70 means borderline. Below 55 means significant gaps.
- Be honest and specific. Do not inflate scores.`;
}
