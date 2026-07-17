// The canonical V1 blueprint structure. Keys are stable identifiers
// (stored on BlueprintSection.key) — add new keys rather than reusing.

export interface BlueprintSectionDef {
  key: string;
  title: string;
  guidance: string; // what the AI should produce for this section
}

export const blueprintSectionDefs: BlueprintSectionDef[] = [
  {
    key: 'executive_summary',
    title: 'Executive Summary',
    guidance: 'A crisp overview of the product, who it serves, and why now. 2-3 short paragraphs.',
  },
  {
    key: 'problem_statement',
    title: 'Problem Statement',
    guidance: 'The specific problem, who feels it, evidence it is real, and what people do today instead.',
  },
  {
    key: 'solution',
    title: 'Solution',
    guidance: 'How the product solves the problem; the core value proposition and the key insight.',
  },
  {
    key: 'target_audience',
    title: 'Target Audience',
    guidance: 'The ideal first customer, narrowed as far as the discovery answers allow. Include where to reach the first 100.',
  },
  {
    key: 'business_model',
    title: 'Business Model',
    guidance: 'Who pays, for what, and the pricing shape. Flag open questions honestly.',
  },
  {
    key: 'differentiation',
    title: 'Differentiation & Moat',
    guidance: 'Current alternatives, why users would switch, and what makes this defensible over time.',
  },
  {
    key: 'mvp_scope',
    title: 'MVP Scope',
    guidance: 'The single core action of version one, what is explicitly OUT of scope, and the leanest path to launch.',
  },
  {
    key: 'success_metrics',
    title: 'Success Metrics',
    guidance: 'Measurable signals that the product is working at 3 months post-launch. Concrete numbers.',
  },
];
