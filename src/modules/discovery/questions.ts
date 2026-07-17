// The V1 question bank for the guided discovery interview, organized by
// module (mirrors the PRD: problem, customer, business model,
// differentiation, MVP focus). IDs are stable keys — answers reference
// them, so never reuse an id for a different question; add new ids instead.
//
// When the AI layer lands, these become the "anchor" questions and the
// model generates adaptive follow-ups between them.

export interface DiscoveryQuestion {
  id: string;
  module: string;
  text: string;
  hint?: string;
}

export const DISCOVERY_MODULES = [
  'problem',
  'customer',
  'business_model',
  'differentiation',
  'mvp_focus',
] as const;

export const discoveryQuestions: DiscoveryQuestion[] = [
  // ── Module 1: Problem ──
  {
    id: 'problem.core',
    module: 'problem',
    text: 'What specific problem does your product solve, and what happens today when people hit it?',
    hint: 'Describe the pain in one or two sentences — what do people currently do instead?',
  },
  {
    id: 'problem.evidence',
    module: 'problem',
    text: 'How do you know this problem is real? What evidence have you seen or gathered?',
    hint: 'Conversations, your own experience, communities, competitors existing — anything concrete.',
  },
  // ── Module 2: Customer ──
  {
    id: 'customer.who',
    module: 'customer',
    text: 'Who feels this problem most acutely? Describe your ideal first customer.',
    hint: '"Everyone" is not an answer — the narrower the first customer, the stronger the start.',
  },
  {
    id: 'customer.where',
    module: 'customer',
    text: 'Where do these people gather, and how would you reach the first 100 of them?',
    hint: 'Specific communities, channels, or geographies — not "social media."',
  },
  // ── Module 3: Business model ──
  {
    id: 'business_model.payer',
    module: 'business_model',
    text: 'Who pays, and what are they paying for exactly?',
    hint: 'The user and the payer are not always the same person.',
  },
  {
    id: 'business_model.pricing',
    module: 'business_model',
    text: 'What pricing shape fits — subscription, one-time, usage-based — and roughly what price point?',
    hint: 'A rough anchor is fine; what would feel obviously cheap and obviously expensive?',
  },
  // ── Module 4: Differentiation ──
  {
    id: 'differentiation.alternatives',
    module: 'differentiation',
    text: 'What do people use today instead of your product, and why would they switch?',
    hint: 'Include non-obvious competitors: spreadsheets, hiring someone, doing nothing.',
  },
  {
    id: 'differentiation.moat',
    module: 'differentiation',
    text: 'If this works, what stops a bigger player from copying it in six months?',
    hint: 'Process, community, data, distribution, focus — "better execution" alone is fragile.',
  },
  // ── Module 5: MVP focus ──
  {
    id: 'mvp_focus.essential',
    module: 'mvp_focus',
    text: 'What is the single core action a user must be able to do in version one?',
    hint: 'One sentence. Everything else is a later version.',
  },
  {
    id: 'mvp_focus.success',
    module: 'mvp_focus',
    text: 'Three months after launch, what result would tell you this is working?',
    hint: 'A number you could actually measure: users, retention, revenue, time saved.',
  },
];

export function getQuestion(id: string): DiscoveryQuestion | undefined {
  return discoveryQuestions.find((q) => q.id === id);
}
