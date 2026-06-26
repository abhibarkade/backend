// Minimal valid PDF buffer for upload tests
// Encodes a single-page PDF with the text "Test Resume John Doe Software Engineer"
export const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>\nendobj\n' +
  'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n217\n%%EOF',
  'utf-8',
);

export const SAMPLE_JD = `
Senior Software Engineer - Backend (Node.js)

About the Role:
We are looking for a Senior Backend Engineer to join our growing platform team. You will design
and build scalable microservices, work closely with product teams, and help shape our technical roadmap.

Responsibilities:
- Design and implement RESTful APIs and microservices using Node.js and TypeScript
- Work with PostgreSQL and Redis for data storage and caching
- Build and maintain CI/CD pipelines
- Write comprehensive unit and integration tests
- Mentor junior engineers and lead code reviews
- Collaborate with frontend engineers on API contracts

Requirements:
- 5+ years of backend software engineering experience
- Strong proficiency in Node.js and TypeScript
- Experience with PostgreSQL, Redis, and message queues (RabbitMQ, Kafka, or BullMQ)
- Familiarity with Docker and Kubernetes
- Experience with REST API design and OpenAPI/Swagger documentation
- Strong understanding of distributed systems and microservices architecture
- Experience with AWS or GCP cloud platforms
- Excellent communication and collaboration skills

Nice to have:
- Experience with NestJS framework
- Knowledge of GraphQL
- Prior experience with event-driven architectures
`;
