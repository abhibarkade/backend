import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Fixed dev/test user — stable UUID for integration tests
const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  // Seed the default dev/test user (idempotent)
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {},
    create: {
      id: DEV_USER_ID,
      email: 'dev@tailor.test',
      fullName: 'Dev User',
      role: 'user',
    },
  });


  await prisma.template.createMany({
    skipDuplicates: true,
    data: [
      {
        icon: '🎨',
        iconVariant: 'amber',
        name: 'Product Designer',
        description: 'Senior IC or lead designer roles at tech companies. Emphasises systems thinking, cross-functional collaboration, and measurable impact.',
        uses: 1240,
        sampleJd: `We are looking for a Senior Product Designer to join our team. You will lead design for our core product surfaces, working closely with engineering, product, and research to ship high-quality experiences.

Responsibilities:
- Lead end-to-end design for 1-2 product areas, from discovery through delivery
- Build and maintain components in our Figma design system
- Conduct user research and usability testing
- Collaborate with engineers on implementation details
- Present design decisions to stakeholders with clear rationale

Requirements:
- 5+ years of product design experience
- Strong portfolio demonstrating systems thinking and impact
- Proficiency in Figma including design systems and auto-layout
- Experience with A/B testing and data-informed design
- Strong communication skills for cross-functional collaboration`,
        sortOrder: 0,
      },
      {
        icon: '💻',
        iconVariant: 'sage',
        name: 'Software Engineer',
        description: 'Mid to senior SWE roles. Focuses on technical depth, system design, and shipping production code at scale.',
        uses: 2180,
        sampleJd: `We are hiring a Senior Software Engineer to work on our backend platform. You will design and implement scalable systems that serve millions of users.

Responsibilities:
- Design, build, and maintain backend services and APIs
- Lead technical design discussions and write design documents
- Mentor junior engineers and conduct code reviews
- Collaborate with product and infrastructure teams
- Drive technical quality and engineering best practices

Requirements:
- 4+ years of backend software engineering experience
- Strong proficiency in at least one of: Go, Python, Java, TypeScript/Node.js
- Experience designing distributed systems and APIs at scale
- Familiarity with cloud platforms (AWS, GCP, or Azure)
- Experience with SQL and NoSQL databases`,
        sortOrder: 1,
      },
      {
        icon: '📊',
        iconVariant: 'clay',
        name: 'Product Manager',
        description: 'PM roles at growth-stage and enterprise companies. Highlights roadmap ownership, data-driven decisions, and cross-functional leadership.',
        uses: 890,
        sampleJd: `We are seeking a Product Manager to own our growth product area. You will define strategy, prioritise the roadmap, and work closely with design and engineering to ship features that drive user acquisition and retention.

Responsibilities:
- Own the product roadmap for one or more product areas
- Define success metrics and track KPIs
- Run discovery with customers and translate insights into requirements
- Partner with design, engineering, data science, and marketing
- Communicate product vision to leadership and stakeholders

Requirements:
- 3+ years of product management experience
- Demonstrated ability to define and measure product success
- Strong analytical skills; comfortable with SQL and data tools
- Experience with agile development processes
- Excellent written and verbal communication`,
        sortOrder: 2,
      },
    ],
  });

  console.log('Seed completed.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
