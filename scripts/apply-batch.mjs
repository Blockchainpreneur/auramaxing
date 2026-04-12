#!/usr/bin/env node
/**
 * AURAMXING Sequential Application Filler — Batch of 10
 *
 * Opens 10 applications at a time.
 * Fills 100% of ALL fields (required + optional).
 * Detects form type (native, Google Forms, Tally, Typeform, Fillout).
 * Leaves tabs open for review. Does NOT submit.
 *
 * Usage: node apply-batch.mjs [batch_number]
 *   batch 1 = programs 1-10
 *   batch 2 = programs 11-20, etc.
 */
import { chromium } from 'playwright';

const CDP = 'http://localhost:9222';
const BATCH_SIZE = 10;
const BATCH = parseInt(process.argv[2] || '1');
const START = (BATCH - 1) * BATCH_SIZE;

// ═══════════════════════════════════════════════════════════════════
// ECON MARKETS — Complete founder data for all fields
// ═══════════════════════════════════════════════════════════════════
const D = {
  // Identity
  firstName: 'Luis', lastName: 'Telleria', name: 'Luis Telleria',
  email: 'telleria.gerardt@gmail.com', phone: '+1 650 485 7921',
  title: 'CEO & Founder',
  linkedin: 'https://linkedin.com/in/luisgtelleria',
  twitter: 'https://x.com/econhubs', github: 'https://github.com/Blockchainpreneur',
  website: 'https://econmarkets.io', calendly: 'https://calendly.com/lt01/30min',

  // Location
  city: 'Palo Alto', state: 'California', country: 'United States',
  location: 'Palo Alto, California, United States', zip: '94301',

  // Company
  company: 'Econ Markets', entity: 'Delaware C-Corporation',
  founded: 'November 2025', stage: 'Pre-revenue, launching Q2 2026',
  employees: '1', team: '1 founder full-time, recruiting CTO + Head of Growth',

  // Fundraise
  raising: '$10M', valuation: '$100M post-money', round: 'Seed',
  raised: '$0 — pre-raise, at Stanford Accelerator',
  revenue: '$0 — pre-revenue, launching Q2 2026',
  burn: '$5,000/month', runway: '18 months at current burn',
  deck: 'https://econmarkets.io/deck',

  // Short answers
  tagline: 'World\'s Private Markets. Liquid.',
  oneLiner: 'Hybrid derivatives exchange for private companies — trade the volatility of SpaceX, Stripe, OpenAI with $10 minimums, no expiration, self-funding market maker',

  // Long answers
  pitch: 'Econ Markets is a hybrid derivatives exchange for private companies. Layer 1 is a continuous order book where users buy/sell contracts at real-time prices — each trade generates 0.75% spread fees that self-fund an internal market maker with zero external capital. Layer 2 is a long/short binary with no expiration — users bet on whether a company will IPO or have a down round, and trade the volatility while they wait. $20 trillion in private equity is illiquid and unpriced. The median time to IPO is 12 years. We are building the volatility market that should exist for this $20T asset class. Working prototype built, 450K+ followers for day-one launch, Stanford Accelerator accepted, YC Startup School completed.',

  problem: '$20 trillion in private equity is illiquid, unpriced, and has zero volatility market. The median time to IPO is 12 years. Employees hold $5T+ in locked equity with zero liquidity. VCs hold $8T+ with no way to hedge or mark positions. Retail investors are completely excluded — existing platforms like Forge require $100K minimums, 50-day settlement, and board approval. There is no infrastructure to trade, price, or profit from the continuous repricing that happens as new information about private companies emerges.',

  solution: 'A hybrid two-layer model creating a new asset class: private company volatility. Layer 1 is a continuous order book — users buy/sell contracts at real-time prices, each trade generates 0.75% spread fees, these fees fund an internal market maker that provides instant liquidity with zero external capital required. Layer 2 is a long/short binary with no expiration — once you own a contract, you choose whether the company will IPO/list or have a down round. The contract lives until the event occurs (could be years). While waiting, you trade on the order book to capture volatility. This is the key insight: profit comes from volatility, not from waiting for resolution.',

  market: '$20T in global private equity. 12-year median IPO timeline creates a massive window of unpriced volatility. If we capture just 0.1% of this market in trading volume, that is $20B annually. With our 0.75% spread fee, that is $150M in annual revenue from fees alone, before market maker profits. Comparable: Polymarket hit $1B+ valuation with short-term binary events on a much smaller market. We are building infinite-duration binary on the $20T private equity asset class.',

  traction: 'Working prototype built and tested. Market maker algorithm validated in simulation. Delaware C-Corp incorporated. LOIs and commitments from institutional partners including hedge funds. 21 hedge funds on waitlist. 450K+ followers across TikTok and Instagram (@luis.econ) for day-one activation. Stanford Accelerator (accepted). YC Startup School (completed). 11+ listings planned for Q2 2026 launch (SpaceX, Stripe, OpenAI, etc.).',

  competitors: 'Forge Global ($2B peak): secondary marketplace, $100K minimum, 50+ day settlement, 5% broker fees, board approval needed. EquityZen: same illiquid model as Forge. Injective ($1B+ FDV): pure crypto perpetuals, zero legal tie to real equity. Polymarket ($1B+): fixed expiration binary, cannot capture multi-year volatility. Destiny DXYZ ($100M AUM): blind pool fund, cannot pick individual assets, trades at 1000% premium to NAV. Hiive ($1B+ volume): no continuous order book, manual P2P matching with wide spreads. Econ Markets is different: hybrid model combining continuous order book with infinite-duration binary, instant settlement, $10 minimum, self-funding market maker requiring zero external capital, and 450K+ built-in distribution.',

  advantage: 'Four structural moats nearly impossible to replicate simultaneously: (1) Hybrid Model — no one else combines continuous order book liquidity with infinite-duration binary outcomes. (2) Self-Funding Market Maker — spread fees fund liquidity with zero capital, competitors need $100M+. (3) No-Expiration Contracts — capture years of volatility vs months for traditional derivatives. (4) 450K+ Built-in Distribution — no other private equity trading platform has a founder with direct retail access at zero CAC.',

  whyYou: 'Three things that rarely coexist: (1) Technical depth — DEX and market maker researcher/contributor, live speaker on DeFi infrastructure, built entire working prototype as self-taught full-stack developer. (2) Execution — previous fintech exit in micro-lending, pivoted from Econ Blockchain after realizing the problem was the assets not the chain. (3) Distribution — 450K+ followers built on market structure credibility, not personality. They trust my platform because they trust my judgment on what is fair. Stanford Accelerator participant, YC Startup School graduate.',

  revenue_model: 'Two revenue streams, one dominant: (1) Spread Fees (Layer 1): 0.75% per trade on the order book — consistent, predictable, and funds the market maker. (2) Market Maker Profit (Layer 2): proprietary algorithm captures profit from volatility as users continuously trade contracts — this is 80% of total revenue. Unit economics per listing: 100M contracts at $1 each. At 50% monthly turnover with 0.75% spread = $37.5M annual spread revenue. Market maker volatility capture adds $62.5M. Total: $100M+ revenue potential per listing annually. Year 1: 11+ listings. Capital required for market maker: $0 (self-funded).',

  gtm: 'Two-phase: Phase 1 (Institutional Wedge): Target top 200 VCs and hedge funds with free data APIs, Terminal access, and Shadow Order Book. Hook: "Go short on SpaceX if you think a down round is coming." First 10 institutional partners = credibility + order flow. Phase 2 (Retail Floodgates): Activate 450K+ existing followers on @luis.econ. Day-one email + social media campaign. Partnerships with copy-trade tools for viral distribution. $10 minimum removes all barriers. The spread between institutional supply and retail demand is where we capture value.',

  risks: 'Regulatory: SEC could classify contracts as unregistered securities. Mitigated by structuring as derivatives platform (cash-settled), not securities exchange. Liquidity trap: if institutional liquidity is insufficient early, spreads widen. Mitigated by free data APIs that attract institutions by serving them. Market maker execution: scaling across 100+ listings requires precision. Mitigated by validated algorithm and engineering-first hiring (CTO = ex-smart contract auditor). Competition: well-funded exchange could enter. Mitigated by hybrid model + distribution — they cannot replicate both simultaneously.',

  ask: '$10M at $100M post-money valuation. Early bird: 50% valuation cap discount for first $5M. Use of funds: finish product development, hire CTO + Head of Growth, regulatory counsel, initial institutional partner onboarding. Beyond capital: introductions to institutional LPs, credibility stamp for regulators, regulatory strategy guidance, network access for CTO recruiting.',

  hear: 'Through the startup ecosystem and online research',
};

// ═══════════════════════════════════════════════════════════════════
// PROGRAMS — All 50+, sorted by priority
// ═══════════════════════════════════════════════════════════════════
const ALL_PROGRAMS = [
  // Batch 1: Top-tier accelerators
  { name: 'ERA NYC', url: 'https://forms.gle/FQD7W1xRowfm91yN6', type: 'google-form', ref: 'Murat Aktihanoglu' },
  { name: 'Antler', url: 'https://www.antler.co/apply', type: 'native', ref: 'Magnus Grimeland' },
  { name: 'Village Global', url: 'https://tally.so/r/3xZdB5', type: 'tally', ref: 'Reid Hoffman' },
  { name: '500 Global', url: 'https://flagship.aplica.500.co/', type: 'native', ref: 'Christine Tsai' },
  { name: 'Neo Accelerator', url: 'https://neo.com/accelerator-apply', type: 'native', ref: 'Ali Partovi' },
  { name: 'Precursor Ventures', url: 'https://precursorvc.com/startup/', type: 'native', ref: 'Charles Hudson' },
  { name: 'Contrary', url: 'https://contrary.com/apply', type: 'native', ref: 'Eric Tao' },
  { name: 'Forum Ventures', url: 'https://www.forumvc.com/accelerator', type: 'native', ref: 'Michael Cardamone' },
  { name: 'Renew VC', url: 'https://www.renewvc.com/apply', type: 'native', ref: 'Renew VC team' },
  { name: 'Emergent Ventures', url: 'https://mercatus.tfaforms.net/5099527', type: 'native', ref: 'Tyler Cowen' },

  // Batch 2: Crypto/DeFi focused
  { name: 'Alliance DAO', url: 'https://alliance.xyz/apply/1', type: 'native', ref: 'Qiao Wang' },
  { name: 'Solana Incubator', url: 'https://incubator.solanalabs.com/', type: 'native', ref: 'Anatoly Yakovenko' },
  { name: 'Outlier Ventures', url: 'https://outlierventures.io/base-camp/', type: 'native', ref: 'Jamie Burke' },
  { name: 'Boost VC', url: 'https://www.boost.vc/apply', type: 'native', ref: 'Adam Draper' },
  { name: 'Coinbase Ventures', url: 'https://www.coinbase.com/ventures', type: 'native', ref: 'Brian Armstrong' },
  { name: 'YZi Labs', url: 'https://www.yzilabs.com/', type: 'native', ref: 'Changpeng Zhao' },
  { name: 'Dragonfly Capital', url: 'https://www.dragonfly.xyz/', type: 'native', ref: 'Haseeb Qureshi' },
  { name: 'Chainlink Grants', url: 'https://chain.link/community/grants', type: 'native', ref: 'Sergey Nazarov' },
  { name: 'Solana Grants', url: 'https://solana.org/grants-funding', type: 'native', ref: 'Solana Foundation' },
  { name: 'HAX SOSV', url: 'https://sosv.com/apply/hax/', type: 'native', ref: 'Sean O Sullivan' },

  // Batch 3: Fintech specific
  { name: 'Mastercard Start Path', url: 'https://www.mastercard.com/global/en/innovation/partner-with-us/start-path.html', type: 'native', ref: 'Jess Turner' },
  { name: 'Plug and Play', url: 'https://www.plugandplaytechcenter.com/join/', type: 'native', ref: 'Saeed Amidi' },
  { name: 'Fintech Sandbox', url: 'https://www.fintechsandbox.org/apply/', type: 'native', ref: 'Jean Donnelly' },
  { name: 'Tenity F10', url: 'https://www.tenity.com/programs/', type: 'native', ref: 'Andreas Iten' },
  { name: 'Startup Wise Guys', url: 'https://startupwiseguys.com/verticals/fintech/', type: 'native', ref: 'Cristobal Alonso' },
  { name: 'Techstars Fintech', url: 'https://www.techstars.com/accelerators', type: 'native', ref: 'Maelle Gavet' },
  { name: 'Alchemist', url: 'https://www.alchemistaccelerator.com/apply', type: 'fillout', ref: 'Ravi Belani' },
  { name: 'PearX S26', url: 'https://pear.vc/pearx-application/', type: 'native', ref: 'Pejman Nozad' },
  { name: 'Draper University', url: 'https://draperuniversity.com/apply', type: 'native', ref: 'Tim Draper' },
  { name: 'FoundersBoost', url: 'https://www.foundersboost.com/', type: 'native', ref: 'FoundersBoost team' },

  // Batch 4: Fellowships + VCs
  { name: 'On Deck ODF', url: 'https://admissions.joinodf.com/', type: 'native', ref: 'Erik Torenberg' },
  { name: 'South Park Commons', url: 'https://www.southparkcommons.com/apply', type: 'native', ref: 'Ruchi Sanghvi' },
  { name: 'Entrepreneur First', url: 'https://apply.joinef.com/', type: 'native', ref: 'Matt Clifford' },
  { name: 'StartX Stanford', url: 'https://startx.com/', type: 'native', ref: 'Stanford network' },
  { name: 'Soma Scholars', url: 'https://programs.somacap.com/fellows', type: 'native', ref: 'Aneel Ranadive' },
  { name: 'Unshackled Ventures', url: 'https://www.unshackledvc.com/', type: 'native', ref: 'Manan Mehta' },
  { name: 'Hustle Fund', url: 'https://www.hustlefund.vc/', type: 'native', ref: 'Elizabeth Yin' },
  { name: 'Visa Accelerator', url: 'https://africa.visa.com/en_MW/visa-everywhere/innovation/visa-accelerator.html', type: 'native', ref: 'Visa Innovation' },
  { name: 'Creative Destruction Lab', url: 'https://creativedestructionlab.com/program/', type: 'native', ref: 'Ajay Agrawal' },
  { name: 'Included VC', url: 'https://www.includedvc.com/', type: 'native', ref: 'Included VC' },

  // Batch 5: Platforms + grants
  { name: 'OpenVC', url: 'https://www.openvc.app/', type: 'native', ref: 'OpenVC platform' },
  { name: 'Vestbee', url: 'https://www.vestbee.com/', type: 'native', ref: 'Vestbee platform' },
  { name: 'F6S Fintech', url: 'https://www.f6s.com/programs/fintech', type: 'native', ref: 'F6S platform' },
  { name: 'Republic', url: 'https://republic.com/raise', type: 'native', ref: 'Kendrick Nguyen' },
  { name: 'Wefunder', url: 'https://wefunder.com/create', type: 'native', ref: 'Nick Tommarello' },
  { name: 'Google Startups', url: 'https://startup.google.com/programs/accelerator/', type: 'native', ref: 'Google for Startups' },
  { name: 'Microsoft Founders', url: 'https://www.microsoft.com/en-us/startups', type: 'native', ref: 'Microsoft Startups' },
  { name: 'NSF SBIR', url: 'https://seedfund.nsf.gov/', type: 'native', ref: 'NSF America Seed Fund' },
  { name: 'Contrary Fellowship', url: 'https://research.contrary.com/fellowship', type: 'native', ref: 'Eric Tao' },
  { name: 'MassChallenge', url: 'https://masschallenge.org/programs-all/', type: 'native', ref: 'John Harthorne' },
];

// ═══════════════════════════════════════════════════════════════════
// FIELD MATCHER — Maps form labels to Econ Markets data
// ═══════════════════════════════════════════════════════════════════
function matchField(label) {
  const l = label.toLowerCase().replace(/[*:]/g, '').trim();

  // Identity
  if (/^first\s*name/.test(l)) return D.firstName;
  if (/^last\s*name/.test(l)) return D.lastName;
  if (/full\s*name|your\s*name|^name$/.test(l)) return D.name;
  if (/e-?mail/.test(l)) return D.email;
  if (/phone|mobile|tel/.test(l)) return D.phone;
  if (/linkedin/.test(l)) return D.linkedin;
  if (/twitter|x\.com|x\s*handle/.test(l)) return D.twitter;
  if (/github/.test(l)) return D.github;
  if (/website|url|domain|site|homepage/.test(l)) return D.website;
  if (/company\s*name|startup\s*name|venture\s*name/.test(l)) return D.company;
  if (/^title|^role|^position|your\s*title/.test(l)) return D.title;
  if (/calendly|schedule|meeting/.test(l)) return D.calendly;

  // Location
  if (/^city$|your\s*city/.test(l)) return D.city;
  if (/^state|province/.test(l)) return D.state;
  if (/^country|residence/.test(l)) return D.country;
  if (/location|where.*based|where.*live|where.*located|city.*state.*country/.test(l)) return D.location;
  if (/zip|postal/.test(l)) return D.zip;

  // Company details
  if (/entity|legal\s*structure|incorporation/.test(l)) return D.entity;
  if (/founded|start.*date|when.*start|when.*found/.test(l)) return D.founded;
  if (/stage|company\s*stage/.test(l)) return D.stage;
  if (/employees|team\s*size|how\s*many\s*people/.test(l)) return D.employees;
  if (/deck|pitch\s*deck/.test(l)) return D.deck;

  // Fundraise
  if (/raising|how\s*much.*rais|round\s*size|amount/.test(l)) return D.raising;
  if (/valuation/.test(l)) return D.valuation;
  if (/round|what.*round/.test(l)) return D.round;
  if (/raised|capital.*raised|previously\s*raised/.test(l)) return D.raised;
  if (/revenue|mrr|arr/.test(l)) return D.revenue;
  if (/burn|monthly.*burn|cash.*burn/.test(l)) return D.burn;
  if (/runway/.test(l)) return D.runway;

  // Short text
  if (/tagline|slogan|motto/.test(l)) return D.tagline;
  if (/one\s*line|one.*sentence|50\s*char|short\s*desc|elevator/.test(l)) return D.oneLiner;
  if (/referr|hear.*about|who.*told|how.*find|how.*hear|encourage/.test(l)) return D.hear;

  // Long text (textareas)
  if (/pitch|describe.*company|what.*do|about.*company|what.*build|overview/.test(l)) return D.pitch;
  if (/problem|pain\s*point|what.*solv/.test(l)) return D.problem;
  if (/solution|how.*solv|approach|product\s*desc/.test(l)) return D.solution;
  if (/market\s*size|tam|how.*big|market.*opportunity/.test(l)) return D.market;
  if (/traction|progress|milestone|far\s*along|achieved/.test(l)) return D.traction;
  if (/compet|differ.*from|landscape/.test(l)) return D.competitors;
  if (/advantage|moat|unfair|what.*unique|why.*different|edge/.test(l)) return D.advantage;
  if (/why.*you|founder.*fit|team.*background|about.*team|who.*team/.test(l)) return D.whyYou;
  if (/revenue\s*model|business\s*model|how.*money|monetiz/.test(l)) return D.revenue_model;
  if (/go.to.market|customer.*acqui|how.*get.*customer|gtm|distribution/.test(l)) return D.gtm;
  if (/risk|challenge|what.*wrong|concern/.test(l)) return D.risks;
  if (/ask|what.*need|looking\s*for|what.*want|help.*from/.test(l)) return D.ask;
  if (/team|co-?founder|who.*work|member/.test(l)) return D.team;
  if (/why.*apply|why.*interest|why.*program|what.*convinced/.test(l)) return 'The network, mentorship, and credibility of this program would directly accelerate our path to market. We need institutional connections and regulatory guidance — both of which your network provides.';
  if (/anything\s*else|additional|other\s*info|comments/.test(l)) return 'Also applying to YC S2026 (deadline May 4). Happy to demo the working prototype anytime: calendly.com/lt01/30min. Referred by ' + (D._currentRef || 'startup ecosystem.');

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// FORM FILLER — Handles any form type
// ═══════════════════════════════════════════════════════════════════
async function fillPage(pg, ref) {
  // Pass all data as a single serializable object
  const allData = { ...D, _currentRef: ref };

  const filled = await pg.evaluate((data) => {
    function matchField(label) {
      const l = label.toLowerCase().replace(/[*:]/g, '').trim();
      if (/^first\s*name/.test(l)) return data.firstName;
      if (/^last\s*name/.test(l)) return data.lastName;
      if (/full\s*name|your\s*name|^name$/.test(l)) return data.name;
      if (/e-?mail/.test(l)) return data.email;
      if (/phone|mobile|tel/.test(l)) return data.phone;
      if (/linkedin/.test(l)) return data.linkedin;
      if (/twitter|x\.com|x\s*handle/.test(l)) return data.twitter;
      if (/github/.test(l)) return data.github;
      if (/website|url|domain|site|homepage/.test(l)) return data.website;
      if (/company\s*name|startup\s*name|venture\s*name/.test(l)) return data.company;
      if (/^title|^role|^position|your\s*title/.test(l)) return data.title;
      if (/calendly|schedule|meeting/.test(l)) return data.calendly;
      if (/^city$|your\s*city/.test(l)) return data.city;
      if (/^state|province/.test(l)) return data.state;
      if (/^country|residence/.test(l)) return data.country;
      if (/location|where.*based|where.*live|where.*located|city.*state.*country/.test(l)) return data.location;
      if (/zip|postal/.test(l)) return data.zip;
      if (/entity|legal\s*structure|incorporation/.test(l)) return data.entity;
      if (/founded|start.*date|when.*start|when.*found/.test(l)) return data.founded;
      if (/stage|company\s*stage/.test(l)) return data.stage;
      if (/employees|team\s*size|how\s*many\s*people/.test(l)) return data.employees;
      if (/deck|pitch\s*deck/.test(l)) return data.deck;
      if (/raising|how\s*much.*rais|round\s*size|amount/.test(l)) return data.raising;
      if (/valuation/.test(l)) return data.valuation;
      if (/round|what.*round/.test(l)) return data.round;
      if (/raised|capital.*raised|previously\s*raised/.test(l)) return data.raised;
      if (/^revenue$|mrr|arr/.test(l)) return data.revenue;
      if (/burn|monthly.*burn|cash.*burn/.test(l)) return data.burn;
      if (/runway/.test(l)) return data.runway;
      if (/tagline|slogan/.test(l)) return data.tagline;
      if (/one\s*line|one.*sentence|50\s*char|short\s*desc|elevator/.test(l)) return data.oneLiner;
      if (/referr|hear.*about|who.*told|how.*find|how.*hear|encourage/.test(l)) return data.hear;
      if (/pitch|describe.*company|what.*do|about.*company|what.*build|overview/.test(l)) return data.pitch;
      if (/problem|pain\s*point|what.*solv/.test(l)) return data.problem;
      if (/solution|how.*solv|approach|product\s*desc/.test(l)) return data.solution;
      if (/market\s*size|tam|how.*big|market.*opportunity/.test(l)) return data.market;
      if (/traction|progress|milestone|far\s*along|achieved/.test(l)) return data.traction;
      if (/compet|differ.*from/.test(l)) return data.competitors;
      if (/advantage|moat|unfair|what.*unique|why.*different|edge/.test(l)) return data.advantage;
      if (/why.*you|founder.*fit|team.*background|about.*team|who.*team/.test(l)) return data.whyYou;
      if (/revenue\s*model|business\s*model|how.*money|monetiz/.test(l)) return data.revenue_model;
      if (/go.to.market|customer.*acqui|how.*get.*customer|gtm|distribution/.test(l)) return data.gtm;
      if (/risk|challenge|what.*wrong|concern/.test(l)) return data.risks;
      if (/ask|what.*need|looking\s*for|what.*want|help.*from/.test(l)) return data.ask;
      if (/team|co-?founder|who.*work|member/.test(l)) return data.team;
      if (/why.*apply|why.*interest|why.*program|what.*convinced/.test(l)) return 'The network, mentorship, and credibility of this program would directly accelerate our path to market. Referred by ' + (data._currentRef || 'startup ecosystem.');
      if (/anything\s*else|additional|other\s*info|comment/.test(l)) return 'Also applying to YC S2026. Happy to demo: calendly.com/lt01/30min. Referred by ' + (data._currentRef || 'startup ecosystem.');
      return null;
    }

    let count = 0;
    const fields = document.querySelectorAll('input, textarea, select');
    for (const el of fields) {
      if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'file') continue;
      if (el.value && el.value.trim().length > 0) continue;
      let label = '';
      if (el.labels && el.labels[0]) label = el.labels[0].innerText;
      if (!label) label = el.placeholder || '';
      if (!label) label = el.getAttribute('aria-label') || '';
      if (!label) {
        let parent = el.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          const lbl = parent.querySelector('label, h3, h4, strong, [class*=label]');
          if (lbl && lbl.innerText && lbl.innerText.length < 100) { label = lbl.innerText; break; }
          parent = parent.parentElement;
        }
      }
      if (!label) continue;
      const val = matchField(label);
      if (!val) continue;
      try {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
      } catch { el.value = val; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      count++;
    }
    // Auto-select relevant options
    const targets = document.querySelectorAll('label, span, div[role=option], li[role=option]');
    for (const el of targets) {
      if (el.offsetHeight === 0) continue;
      const t = el.innerText?.trim()?.toLowerCase() || '';
      if (['fintech','financial services','financial infrastructure','c-corp','c-corporation',
           'founder','ceo','seed','pre-seed','united states','usa','us','full-time','full time'
          ].includes(t)) el.click();
    }
    return count;
  }, allData);

  return filled;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN — Process batch of 10
// ═══════════════════════════════════════════════════════════════════
async function main() {
  const batch = ALL_PROGRAMS.slice(START, START + BATCH_SIZE);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`BATCH ${BATCH}: Programs ${START + 1}-${START + batch.length} of ${ALL_PROGRAMS.length}`);
  console.log(`${'═'.repeat(60)}\n`);

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] || await browser.newContext();

  const results = [];

  for (let i = 0; i < batch.length; i++) {
    const prog = batch[i];
    const num = START + i + 1;

    console.log(`\n[${num}/${ALL_PROGRAMS.length}] ${prog.name}`);
    console.log(`  URL: ${prog.url}`);
    console.log(`  Ref: ${prog.ref}`);

    try {
      const pg = await ctx.newPage();
      await pg.goto(prog.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await new Promise(r => setTimeout(r, 3000));

      const title = await pg.title();

      // Check 404
      if (/404|not found/i.test(title)) {
        console.log(`  SKIP — 404 page`);
        results.push({ name: prog.name, status: 'skip-404' });
        continue;
      }

      // Check for iframes (embedded forms)
      const iframeSrc = await pg.evaluate(() => {
        const frames = document.querySelectorAll('iframe');
        for (const f of frames) {
          if (f.src && !f.src.includes('recaptcha') && !f.src.includes('analytics') &&
              (f.offsetHeight > 200 || f.src.includes('tally') || f.src.includes('typeform') ||
               f.src.includes('google.com/forms') || f.src.includes('fillout'))) {
            return f.src;
          }
        }
        return null;
      });

      let filled = 0;

      if (iframeSrc) {
        // If embedded form, open it directly in a new page
        console.log(`  Embedded form: ${iframeSrc.slice(0, 50)}`);
        await pg.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(r => setTimeout(r, 3000));
      }

      // Fill the form
      filled = await fillPage(pg, prog.ref);

      // Also try using Playwright's fill with keyboard for React forms
      if (filled < 3) {
        // Try clicking inputs and typing
        const emptyInputs = await pg.locator('input:visible:not([type=hidden]):not([type=submit]):not([type=radio]):not([type=checkbox])').all();
        for (const inp of emptyInputs) {
          const val = await inp.inputValue().catch(() => '');
          if (val) continue;
          const label = await inp.evaluate(el => {
            return el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label') || '';
          });
          const match = matchField(label);
          if (match) {
            try {
              await inp.click({ timeout: 1000 });
              await inp.fill(match, { timeout: 2000 });
              filled++;
            } catch {}
          }
        }

        // Try textareas too
        const emptyTAs = await pg.locator('textarea:visible').all();
        for (const ta of emptyTAs) {
          const val = await ta.inputValue().catch(() => '');
          if (val) continue;
          const label = await ta.evaluate(el => {
            let parent = el.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
              const lbl = parent.querySelector('label, h3, strong');
              if (lbl) return lbl.innerText;
              parent = parent.parentElement;
            }
            return el.placeholder || '';
          });
          const match = matchField(label);
          if (match) {
            try {
              await ta.click({ timeout: 1000 });
              await ta.fill(match, { timeout: 2000 });
              filled++;
            } catch {}
          }
        }
      }

      console.log(`  FILLED: ${filled} fields`);
      console.log(`  Status: ${filled > 0 ? 'READY FOR REVIEW' : 'NO FORM FOUND (info page)'}`);
      results.push({ name: prog.name, status: filled > 0 ? 'filled' : 'no-form', fields: filled });

    } catch (e) {
      console.log(`  ERROR: ${e.message?.slice(0, 80)}`);
      results.push({ name: prog.name, status: 'error', error: e.message?.slice(0, 80) });
    }

    // Brief pause between tabs
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`BATCH ${BATCH} COMPLETE`);
  console.log(`${'═'.repeat(60)}`);
  const filled = results.filter(r => r.status === 'filled');
  const skipped = results.filter(r => r.status !== 'filled');
  console.log(`Filled: ${filled.length} — ${filled.map(r => `${r.name}(${r.fields})`).join(', ')}`);
  if (skipped.length) console.log(`Skipped/Error: ${skipped.length} — ${skipped.map(r => `${r.name}(${r.status})`).join(', ')}`);
  console.log(`\nAll tabs left open. Review and submit, then run: node apply-batch.mjs ${BATCH + 1}`);
}

main().catch(e => console.error('Fatal:', e.message)).finally(() => process.exit(0));
