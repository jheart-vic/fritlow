// The discovery interview question LIBRARY.
//
// Two layers:
//   1. CORE questions (`coreQuestions`) — the 7 topics every project's plan
//      covers: problem, customer, business model, differentiation, MVP focus,
//      go-to-market, risks.
//   2. CATEGORY PACKS (`categoryPacks`) — extra questions pulled in when the
//      project matches a product type (SaaS, marketplace, fintech, …).
//
// These are the ANCHOR/library questions. At session start the AI assembles a
// TAILORED per-project plan from this library (see discovery.plan.ts) and may
// reword or add to it; if the AI is unavailable we fall back to the
// deterministic base plan (`assembleBasePlan`) built straight from here.
//
// IDs are stable keys — answers reference them, so never reuse an id for a
// different question; add new ids instead. `getQuestion` still resolves any
// library id (used for the legacy/global fallback).

export interface DiscoveryQuestion {
  id: string;
  module: string;
  text: string;
  hint?: string;
}

// The core interview modules, in the order a plan should generally follow.
export const DISCOVERY_MODULES = [
  'problem',
  'customer',
  'business_model',
  'differentiation',
  'mvp_focus',
  'go_to_market',
  'risks',
] as const;

// ── Core questions — the library the plan draws from for EVERY project ──
export const coreQuestions: DiscoveryQuestion[] = [
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
  {
    id: 'problem.urgency',
    module: 'problem',
    text: 'Is this a must-fix urgency or a nice-to-have? What makes it pressing right now?',
    hint: 'A painkiller sells faster than a vitamin — say why people can\'t just keep ignoring it.',
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
  {
    id: 'customer.current',
    module: 'customer',
    text: 'How are these people solving this today — even with a workaround, a spreadsheet, or nothing at all?',
    hint: 'Your real competition is often "the status quo." Name what you\'re replacing.',
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
  {
    id: 'business_model.cost',
    module: 'business_model',
    text: 'What will it cost you to serve one customer, and what does that leave as margin?',
    hint: 'Think delivery cost per customer (infra, support, payouts) — not fundraising.',
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
    id: 'mvp_focus.exclude',
    module: 'mvp_focus',
    text: 'What are you deliberately NOT building for version one?',
    hint: 'Naming what you cut is as important as what you keep — protect the scope.',
  },
  {
    id: 'mvp_focus.success',
    module: 'mvp_focus',
    text: 'Three months after launch, what result would tell you this is working?',
    hint: 'A number you could actually measure: users, retention, revenue, time saved.',
  },
  // ── Module 6: Go-to-market (NEW) ──
  {
    id: 'go_to_market.channel',
    module: 'go_to_market',
    text: 'What is the first channel you\'ll use to get users — and why that one over the others?',
    hint: 'One focused channel beats five half-efforts. Content, communities, ads, partnerships, sales?',
  },
  {
    id: 'go_to_market.referral',
    module: 'go_to_market',
    text: 'What would make someone tell a friend or colleague about this?',
    hint: 'The specific moment or result worth sharing — word of mouth is the cheapest growth.',
  },
  // ── Module 7: Risks & assumptions (NEW) ──
  {
    id: 'risks.assumption',
    module: 'risks',
    text: 'What is the single belief that, if it turned out to be wrong, would kill this idea?',
    hint: 'The riskiest assumption — the thing you most need to be true. Name it plainly.',
  },
  {
    id: 'risks.hardest',
    module: 'risks',
    text: 'What is the hardest part to actually build or operate — the thing most likely to trip you up?',
    hint: 'Technical, operational, or regulatory — where does this get genuinely hard?',
  },
];

// ── Category packs — extra questions added when the project matches a type ──
// Keyed by a category slug (matches the template catalogue slugs). The pack's
// questions carry a real core module so downstream transcript grouping and the
// health rubric stay coherent.
export const categoryPacks: Record<string, DiscoveryQuestion[]> = {
  saas: [
    {
      id: 'pack.saas.approver',
      module: 'business_model',
      text: 'Who in the buying company signs off on the purchase, and who is the day-to-day user?',
      hint: 'In B2B the buyer and the user are often different people — name both.',
    },
    {
      id: 'pack.saas.integrations',
      module: 'mvp_focus',
      text: 'What existing tools must this integrate with to be usable on day one (e.g. Slack, QuickBooks)?',
      hint: 'B2B software rarely lives alone — missing integrations are silent deal-breakers.',
    },
    {
      id: 'pack.saas.pricing_unit',
      module: 'business_model',
      text: 'Is this priced per seat or per usage — and why does that match how customers get value?',
      hint: 'The pricing unit should track the value metric (seats, actions, volume).',
    },
  ],
  marketplace: [
    {
      id: 'pack.marketplace.first_side',
      module: 'customer',
      text: 'Which side do you attract first — supply or demand — and how do you solve the cold-start?',
      hint: 'The classic chicken-and-egg. Pick the harder side and say how you seed it.',
    },
    {
      id: 'pack.marketplace.trust',
      module: 'differentiation',
      text: 'How do you make both sides trust the platform (reviews, guarantees, verification, escrow)?',
      hint: 'Trust is what lets strangers transact — it\'s often the real product.',
    },
    {
      id: 'pack.marketplace.take_rate',
      module: 'business_model',
      text: 'What is your take rate, and why will both sides accept it rather than going around you?',
      hint: 'Disintermediation risk is real — what keeps the transaction on-platform?',
    },
  ],
  mobile_app: [
    {
      id: 'pack.mobile.habit',
      module: 'mvp_focus',
      text: 'What brings a user back daily or weekly — the core habit loop?',
      hint: 'For consumer mobile, retention beats downloads. Describe the trigger→action→reward.',
    },
    {
      id: 'pack.mobile.discovery',
      module: 'go_to_market',
      text: 'How do people discover your app in a crowded store, and why would they install it?',
      hint: 'App-store discovery is brutal — name the specific hook, not "we\'ll do ASO."',
    },
  ],
  fintech: [
    {
      id: 'pack.fintech.regulation',
      module: 'risks',
      text: 'What regulations or licenses apply, and how will you handle KYC/AML?',
      hint: 'Compliance is a moat and a landmine — surface the regulatory lift early.',
    },
    {
      id: 'pack.fintech.custody',
      module: 'business_model',
      text: 'Do you hold or move customer money? If so, how, and through which banking/partner rails?',
      hint: 'Custody changes everything — licensing, risk, and who your real partners are.',
    },
    {
      id: 'pack.fintech.fraud',
      module: 'risks',
      text: 'How will you detect and handle fraud, chargebacks, or abuse?',
      hint: 'In money movement, fraud is a cost of goods — plan for it, don\'t hope.',
    },
  ],
  edtech: [
    {
      id: 'pack.edtech.outcome',
      module: 'mvp_focus',
      text: 'What measurable learning outcome proves it works, not just that people signed up?',
      hint: 'Completion, skill gain, test scores — tie success to learning, not vanity metrics.',
    },
    {
      id: 'pack.edtech.payer',
      module: 'business_model',
      text: 'Who actually pays — the learner, a school/institution, or an employer?',
      hint: 'Learner, teacher, and payer are often three different people. Name each.',
    },
    {
      id: 'pack.edtech.trust',
      module: 'differentiation',
      text: 'How do you earn the trust of learners and the institutions that gate them?',
      hint: 'Credibility, accreditation, or proven results — trust drives adoption in education.',
    },
  ],
  healthtech: [
    {
      id: 'pack.health.outcome',
      module: 'mvp_focus',
      text: 'What health outcome do you improve, and how will you actually show it?',
      hint: 'Distinguish clinical need from wellness preference — and cite evidence for the claim.',
    },
    {
      id: 'pack.health.payer',
      module: 'business_model',
      text: 'Who pays — patient, provider, employer, or insurer — and what is the reimbursement path?',
      hint: 'Reimbursement reshapes the whole business — state your path explicitly.',
    },
    {
      id: 'pack.health.trust',
      module: 'risks',
      text: 'How do you handle privacy/compliance (e.g. HIPAA/PHI) and build clinical trust?',
      hint: 'Data handling and regulatory scope are make-or-break in health.',
    },
  ],
  social_network: [
    {
      id: 'pack.social.network_effect',
      module: 'differentiation',
      text: 'What makes the product more valuable as more people join?',
      hint: 'The network effect is the moat — describe exactly how value compounds with users.',
    },
    {
      id: 'pack.social.moderation',
      module: 'risks',
      text: 'How will you handle moderation and keep the community healthy as it grows?',
      hint: 'Every social product eventually faces abuse — a plan beats a scramble.',
    },
  ],
};

// Aliases so free-text project categories map onto the pack slugs above.
const CATEGORY_ALIASES: Record<string, keyof typeof categoryPacks> = {
  saas: 'saas',
  'b2b': 'saas',
  software: 'saas',
  marketplace: 'marketplace',
  'two-sided': 'marketplace',
  mobile: 'mobile_app',
  mobile_app: 'mobile_app',
  'mobile app': 'mobile_app',
  app: 'mobile_app',
  consumer: 'mobile_app',
  fintech: 'fintech',
  finance: 'fintech',
  financial: 'fintech',
  edtech: 'edtech',
  education: 'edtech',
  learning: 'edtech',
  healthtech: 'healthtech',
  health: 'healthtech',
  wellness: 'healthtech',
  medical: 'healthtech',
  social: 'social_network',
  social_network: 'social_network',
  community: 'social_network',
};

// Best-effort match of a free-text project category to one pack. Returns the
// pack's questions, or [] when nothing matches (plenty of ideas don't fit a
// pack — that's fine, the core questions still cover them).
export function matchCategoryPack(category?: string | null): DiscoveryQuestion[] {
  if (!category) return [];
  const key = category.trim().toLowerCase();
  // Exact alias hit, else a substring hit ("AI SaaS for teams" → saas).
  const slug =
    CATEGORY_ALIASES[key] ??
    (Object.keys(CATEGORY_ALIASES).find((alias) => key.includes(alias)) as
      | keyof typeof categoryPacks
      | undefined);
  return slug ? categoryPacks[slug] ?? [] : [];
}

// The deterministic base plan for a project: all core questions plus the
// matched category pack. This is what a session uses when AI plan generation
// is skipped or fails — always a complete, sensible interview.
export function assembleBasePlan(category?: string | null): DiscoveryQuestion[] {
  return [...coreQuestions, ...matchCategoryPack(category)];
}

// Backward-compatible alias: the flat core list. (Kept so any older import of
// `discoveryQuestions` keeps working; new code should use the plan helpers.)
export const discoveryQuestions = coreQuestions;

// How many core questions exist — used as the fallback "total" for a session
// whose plan can't be resolved (e.g. a legacy null plan).
export const CORE_QUESTION_COUNT = coreQuestions.length;

// Static per-module metadata — a display label and a rough time estimate, for
// the "Resume Interview" card ("Business Strategy · Estimated time: ~8 mins").
// Illustrative but stable; unknown/AI-added modules fall back to a default.
export const DISCOVERY_MODULE_META: Record<string, { label: string; estimatedMinutes: number }> = {
  problem: { label: 'Problem', estimatedMinutes: 6 },
  customer: { label: 'Customer', estimatedMinutes: 6 },
  business_model: { label: 'Business Model', estimatedMinutes: 8 },
  differentiation: { label: 'Differentiation', estimatedMinutes: 5 },
  mvp_focus: { label: 'MVP Focus', estimatedMinutes: 6 },
  go_to_market: { label: 'Go-to-Market', estimatedMinutes: 5 },
  risks: { label: 'Risks & Assumptions', estimatedMinutes: 5 },
};

const DEFAULT_MODULE_MINUTES = 4;

// Group a session's plan into its modules (in first-appearance order) with a
// label, question count, and time estimate — drives the module list / resume card.
export function planModules(
  plan: Array<{ module: string }>,
): Array<{ module: string; label: string; questionCount: number; estimatedMinutes: number }> {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const q of plan) {
    if (!counts.has(q.module)) order.push(q.module);
    counts.set(q.module, (counts.get(q.module) ?? 0) + 1);
  }
  return order.map((module) => {
    const meta = DISCOVERY_MODULE_META[module];
    return {
      module,
      label: meta?.label ?? module,
      questionCount: counts.get(module) ?? 0,
      estimatedMinutes: meta?.estimatedMinutes ?? DEFAULT_MODULE_MINUTES,
    };
  });
}

// The question count for a session, given its stored plan (a JSONB array) — the
// plan length, or the core count as a fallback for legacy/null plans. Shared by
// the dashboard and the projects list so their `total` never drifts.
export function planTotal(questionPlan: unknown): number {
  return Array.isArray(questionPlan) && questionPlan.length > 0
    ? questionPlan.length
    : CORE_QUESTION_COUNT;
}

// Resolve any library id (core OR pack) — used for the global fallback lookup.
export function getQuestion(id: string): DiscoveryQuestion | undefined {
  const core = coreQuestions.find((q) => q.id === id);
  if (core) return core;
  for (const pack of Object.values(categoryPacks)) {
    const hit = pack.find((q) => q.id === id);
    if (hit) return hit;
  }
  return undefined;
}
