// The V1 template catalogue: fixed starting points by product category, used
// by the create-project wizard (category selection) and to seed category-aware
// hints into the discovery interview. This is read-only reference data — like
// the discovery question bank — so it lives in code, not the database. The
// user-submitted Templates Marketplace (v1.1) is when a `Template` table earns
// its place; until then a static list of 7 is the whole feature.
//
// `id` is a stable slug (never reuse one for a different template). Keys in
// `prefillDiscoveryHints` are discovery question ids (see discovery/questions.ts)
// mapped to a category-specific hint that supplements the question's generic one.

export interface Template {
  id: string;
  category: string;
  name: string;
  description: string;
  prefillDiscoveryHints: Record<string, string>;
}

export const templates: Template[] = [
  {
    id: 'saas',
    category: 'SaaS',
    name: 'SaaS Starter',
    description: 'A subscription web app that solves a recurring workflow problem for businesses or professionals.',
    prefillDiscoveryHints: {
      'customer.who': 'Name the role and company size (e.g. "ops managers at 20–100 person agencies"), not just an industry.',
      'business_model.pricing': 'Per-seat or per-usage monthly subscription is the SaaS norm — anchor a rough price and say what a seat unlocks.',
      'differentiation.moat': 'Workflow lock-in, proprietary data, or integrations are stronger SaaS moats than features alone.',
      'mvp_focus.essential': 'Pick the single recurring job the user would log in for weekly.',
    },
  },
  {
    id: 'marketplace',
    category: 'Marketplace',
    name: 'Marketplace Starter',
    description: 'A two-sided platform connecting buyers and sellers (or supply and demand) and taking a cut.',
    prefillDiscoveryHints: {
      'customer.who': 'Describe BOTH sides — who supplies and who buys — and which side is harder to get.',
      'customer.where': 'Explain how you solve the cold-start: which side you seed first and where you find them.',
      'business_model.payer': 'Usually a take-rate on transactions — state who pays the fee and roughly what %.',
      'differentiation.moat': 'Liquidity and network effects are the real marketplace moat — how do you reach critical mass in one niche first?',
    },
  },
  {
    id: 'mobile_app',
    category: 'Mobile App',
    name: 'Mobile App Starter',
    description: 'A consumer or prosumer mobile-first product where engagement and retention drive value.',
    prefillDiscoveryHints: {
      'problem.core': 'Frame the problem around a moment in the user\'s day when they\'d reach for their phone.',
      'business_model.pricing': 'Freemium, subscription, or one-time — mobile users expect a free tier; say what converts them to paid.',
      'mvp_focus.success': 'Retention (D7/D30) usually matters more than downloads — pick a retention or habit metric.',
    },
  },
  {
    id: 'fintech',
    category: 'FinTech',
    name: 'FinTech Starter',
    description: 'A product that moves, manages, or lends money — where trust, compliance, and unit economics are central.',
    prefillDiscoveryHints: {
      'problem.evidence': 'Cite the specific financial pain and its cost (fees, time, risk) — vague "banking is broken" won\'t do.',
      'business_model.payer': 'Interchange, spread, subscription, or AUM fee — be explicit; FinTech margins vary wildly by model.',
      'differentiation.moat': 'Licenses, compliance, and trust are moats here; note any regulatory lift (KYC/AML) up front.',
      'mvp_focus.essential': 'Scope the smallest money-movement or insight a user would trust you with first.',
    },
  },
  {
    id: 'edtech',
    category: 'EdTech',
    name: 'EdTech Starter',
    description: 'A product that helps people learn a skill or subject — where learning outcomes and who-pays often differ.',
    prefillDiscoveryHints: {
      'customer.who': 'Learner, teacher, and payer are often three different people — name each.',
      'business_model.payer': 'Is it the learner, a school/institution, or an employer? This drives the whole sales motion.',
      'mvp_focus.success': 'Tie success to a learning outcome or completion rate, not just signups.',
    },
  },
  {
    id: 'healthtech',
    category: 'HealthTech',
    name: 'HealthTech Starter',
    description: 'A product in health or wellness — where outcomes, privacy, and (sometimes) clinical/regulatory rigor matter.',
    prefillDiscoveryHints: {
      'problem.evidence': 'Distinguish clinical need from wellness preference, and cite any evidence for the outcome you claim.',
      'business_model.payer': 'Patient, provider, employer, or insurer? Reimbursement changes everything — state your path.',
      'differentiation.moat': 'Data, outcomes evidence, and regulatory clearance are the durable moats; note any HIPAA/PHI scope.',
    },
  },
  {
    id: 'social_network',
    category: 'Social Network',
    name: 'Social Network Starter',
    description: 'A product where the core value is other people — content, connection, or community.',
    prefillDiscoveryHints: {
      'customer.who': 'Define the tightest initial community you can fully serve before expanding.',
      'customer.where': 'Cold-start is everything — where does the first community already gather that you can pull in?',
      'differentiation.moat': 'Network effects and switching costs are the moat; what keeps the community from leaving for the next app?',
      'mvp_focus.success': 'Pick an engagement/retention metric that proves the network is alive (e.g. week-4 return rate).',
    },
  },
];
