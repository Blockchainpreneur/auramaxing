#!/usr/bin/env node
/**
 * AURAMAXING Batch Application Filler
 * Opens each accelerator/VC form, fills all fields with Econ Markets data,
 * leaves tabs open for review. Does NOT submit.
 */
import { chromium } from 'playwright';

const CDP_PORT = 9222;

// Econ Markets founder data
const DATA = {
  name: 'Luis Telleria',
  firstName: 'Luis',
  lastName: 'Telleria',
  email: 'telleria.gerardt@gmail.com',
  phone: '+1 (650) 555-0199',
  linkedin: 'https://linkedin.com/in/luisgtelleria',
  twitter: 'https://x.com/econhubs',
  github: 'https://github.com/Blockchainpreneur',
  website: 'https://econmarkets.io',
  calendly: 'https://calendly.com/lt01/30min',
  location: 'Palo Alto, California, United States',
  city: 'Palo Alto',
  state: 'California',
  country: 'United States',
  company: 'Econ Markets',
  title: 'CEO & Founder',
  tagline: 'Hybrid derivatives exchange for private companies',
  oneLiner: 'Trade the volatility of SpaceX, Stripe, OpenAI — $10 minimum, no expiration, self-funding market maker',
  entity: 'Delaware C-Corporation',
  stage: 'Pre-revenue, launching Q2 2026',
  founded: 'November 2025',
  raising: '$10M',
  valuation: '$100M post-money',
  round: 'Seed',
  deck: 'https://econmarkets.io/deck',

  pitch: `Econ Markets is a hybrid derivatives exchange for private companies. We created a two-layer system: Layer 1 is a continuous order book with a self-funding market maker (zero external capital). Layer 2 is a long/short binary with no expiration — users bet on whether a company will IPO or have a down round, and trade the volatility while they wait. $20 trillion in private equity is illiquid and unpriced. The median time to IPO is 12 years. We are building the volatility market that should exist. Working prototype built, 450K+ followers for launch, Stanford Accelerator, YC Startup School.`,

  problem: `$20 trillion in private equity is illiquid, unpriced, and has zero volatility market. Median time to IPO is 12 years. Employees hold $5T+ in locked equity. VCs hold $8T+ with no way to hedge. Retail is excluded by $100K minimums. There is no infrastructure to trade, price, or profit from the continuous repricing of private companies.`,

  solution: `Hybrid two-layer model creating a new asset class: private company volatility. Layer 1: continuous order book, 0.75% spread fees fund a self-sustaining market maker with zero external capital. Layer 2: long/short binary with no expiration. Users bet on IPO vs down round and trade volatility while waiting. Instant settlement, $10 minimum. Revenue potential $100M+ per listing annually.`,

  traction: `Working prototype built and tested. Market maker algorithm validated. Delaware C-Corp. LOIs from institutional partners including hedge funds. 450K+ followers for day-one activation. Stanford Accelerator (accepted). YC Startup School (completed). 11+ listings planned for Q2 2026 launch.`,

  competitors: `Forge ($2B peak): illiquid, 50-day settlement, $100K min. EquityZen: same slow model. Injective ($1B+ FDV): pure crypto, no legal tie to equity. Polymarket ($1B+): fixed expiration, can't capture multi-year volatility. We are different: hybrid model, instant settlement, $10 min, self-funding market maker, no expiration, 450K distribution.`,

  whyYou: `Market structure researcher and on-chain market maker contributor. Previous fintech exit (micro-lending). Self-taught full-stack developer who built the entire prototype. 450K+ followers built on credibility. Stanford Accelerator. I bridge complex financial engineering with mass-market distribution — most founders can do one, not both.`,

  market: `$20T in private equity globally. 12-year median IPO timeline. If we capture 0.1% in trading volume = $20B annually. At 0.75% spread = $150M revenue before market maker profits. Comparable: Polymarket hit $1B+ valuation with short-term events. We build infinite-duration binary on a $20T asset class.`,

  revenue: `Two streams: 0.75% spread fees per trade (funds market maker) + market maker volatility capture (80% of revenue). 100M contracts per listing at $1 each. $100M+ revenue potential per listing annually. 11+ listings Year 1. Market maker capital required: $0 (self-funded).`,

  team: `Solo technical founder, 18 weeks full-time. Built 100% of the code. Actively recruiting CTO (ex-smart contract auditor) and Head of Growth.`,
};

// Programs to apply to
const PROGRAMS = [
  { name: 'Antler', url: 'https://www.antler.co/apply', referral: 'Magnus Grimeland' },
  { name: 'Neo Accelerator', url: 'https://neo.com/accelerator-apply', referral: 'Ali Partovi' },
  { name: 'Hustle Fund', url: 'https://www.hustlefund.vc/apply', referral: 'Elizabeth Yin' },
  { name: 'Boost VC', url: 'https://www.boost.vc/apply', referral: 'Adam Draper' },
  { name: 'Emergent Ventures', url: 'https://mercatus.tfaforms.net/5099527', referral: 'Tyler Cowen' },
  { name: 'On Deck ODF', url: 'https://admissions.joinodf.com/', referral: 'Erik Torenberg' },
  { name: 'Contrary Fellowship', url: 'https://contrary.com/apply', referral: 'Eric Tao' },
  { name: 'Forum Ventures', url: 'https://www.forumvc.com/accelerator', referral: 'Michael Cardamone' },
  { name: 'Alchemist Accelerator', url: 'https://alchemistaccelerator.com/apply', referral: 'Ravi Belani' },
  { name: 'Techstars', url: 'https://www.techstars.com/accelerators', referral: 'Maelle Gavet' },
  { name: 'ERA NYC', url: 'https://www.eranyc.com/apply/', referral: 'Murat Aktihanoglu' },
  { name: 'Mastercard Start Path', url: 'https://www.mastercard.com/global/en/innovation/partner-with-us/start-path.html', referral: 'Jess Turner' },
  { name: 'Plug and Play Fintech', url: 'https://www.plugandplaytechcenter.com/fintech/', referral: 'Saeed Amidi' },
  { name: 'Draper University', url: 'https://draperuniversity.com/apply', referral: 'Tim Draper' },
  { name: 'Outlier Ventures', url: 'https://outlierventures.io/base-camp/', referral: 'Jamie Burke' },
  { name: 'F10/Tenity Fintech', url: 'https://www.tenity.com/programs/', referral: 'Andreas Iten' },
  { name: 'Fintech Sandbox', url: 'https://www.fintechsandbox.org/apply/', referral: 'Jean Donnelly' },
  { name: 'FoundersBoost', url: 'https://www.foundersboost.com/', referral: 'FoundersBoost team' },
  { name: 'Startup Wise Guys', url: 'https://startupwiseguys.com/verticals/fintech/', referral: 'Cristobal Alonso' },
  { name: 'HAX SOSV', url: 'https://sosv.com/apply/hax/', referral: 'Sean O Sullivan' },
  { name: 'Solana Incubator', url: 'https://incubator.solanalabs.com/', referral: 'Anatoly Yakovenko' },
  { name: 'Coinbase Ventures', url: 'https://www.coinbase.com/ventures', referral: 'Brian Armstrong' },
  { name: 'YZi Labs (Binance)', url: 'https://www.yzilabs.com/', referral: 'Changpeng Zhao' },
  { name: 'OpenVC', url: 'https://www.openvc.app/', referral: 'OpenVC platform' },
  { name: 'Wefunder', url: 'https://wefunder.com/create', referral: 'Nick Tommarello' },
  { name: 'Republic', url: 'https://republic.com/raise', referral: 'Kendrick Nguyen' },
  { name: 'Renew VC', url: 'https://www.renewvc.com/apply', referral: 'Renew VC team' },
  { name: 'Unshackled Ventures', url: 'https://www.unshackledvc.com/', referral: 'Manan Mehta' },
  { name: '500 Global', url: 'https://flagship.aplica.500.co/', referral: 'Christine Tsai' },
  { name: 'Google Startups', url: 'https://startup.google.com/programs/accelerator/', referral: 'Google for Startups' },
  { name: 'Microsoft Founders Hub', url: 'https://www.microsoft.com/en-us/startups', referral: 'Microsoft Startups' },
  { name: 'Soma Scholars', url: 'https://programs.somacap.com/fellows', referral: 'Aneel Ranadive' },
  { name: 'StartX Stanford', url: 'https://startx.com/', referral: 'Stanford network' },
  { name: 'Entrepreneur First', url: 'https://apply.joinef.com/', referral: 'Matt Clifford' },
  { name: 'South Park Commons', url: 'https://www.southparkcommons.com/apply', referral: 'Ruchi Sanghvi' },
  { name: 'Vestbee', url: 'https://www.vestbee.com/', referral: 'Vestbee platform' },
  { name: 'F6S Fintech', url: 'https://www.f6s.com/programs/fintech', referral: 'F6S platform' },
  { name: 'Blockchain Grants', url: 'https://blockchaingrants.org/', referral: 'Various ecosystems' },
  { name: 'Visa Accelerator', url: 'https://africa.visa.com/en_MW/visa-everywhere/innovation/visa-accelerator.html', referral: 'Visa Innovation' },
  { name: 'PearX S26', url: 'https://pear.vc/pearx-application/', referral: 'Pejman Nozad' },
  { name: 'Creative Destruction Lab', url: 'https://creativedestructionlab.com/program/', referral: 'Ajay Agrawal' },
  { name: 'Included VC', url: 'https://www.includedvc.com/', referral: 'Included VC team' },
  { name: 'NSF SBIR', url: 'https://seedfund.nsf.gov/', referral: 'NSF America Seed Fund' },
  { name: 'Solana Grants', url: 'https://solana.org/grants-funding', referral: 'Solana Foundation' },
  { name: 'Chainlink Grants', url: 'https://chain.link/community/grants', referral: 'Sergey Nazarov' },
];

async function fillForm(browser, program) {
  const ctx = browser.contexts()[0];
  let pg;

  try {
    pg = await ctx.newPage();
    await pg.goto(program.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));

    const title = await pg.title();
    console.log(`[${program.name}] Page: ${title.slice(0, 50)}`);

    // Check for 404
    if (/404|not found/i.test(title)) {
      console.log(`[${program.name}] SKIP — 404`);
      return 'skip-404';
    }

    // Generic form filler: find all visible inputs/textareas and fill based on context
    const filled = await pg.evaluate((data) => {
      let count = 0;
      const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea');

      for (const el of inputs) {
        if (el.offsetHeight === 0 || el.value) continue;

        const label = (el.labels?.[0]?.innerText || el.placeholder || el.name || el.id || '').toLowerCase();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                       Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

        let val = '';
        if (/first.?name/i.test(label)) val = data.firstName;
        else if (/last.?name/i.test(label)) val = data.lastName;
        else if (/full.?name|your.?name/i.test(label)) val = data.name;
        else if (/email/i.test(label)) val = data.email;
        else if (/phone/i.test(label)) val = data.phone;
        else if (/linkedin/i.test(label)) val = data.linkedin;
        else if (/twitter|x\.com/i.test(label)) val = data.twitter;
        else if (/github/i.test(label)) val = data.github;
        else if (/website|url|domain|site/i.test(label)) val = data.website;
        else if (/company.?name|startup.?name/i.test(label)) val = data.company;
        else if (/title|role|position/i.test(label)) val = data.title;
        else if (/tagline|one.?line|50.?char|short.?desc/i.test(label)) val = data.tagline;
        else if (/city/i.test(label)) val = data.city;
        else if (/state|province/i.test(label)) val = data.state;
        else if (/country|location/i.test(label)) val = data.location;
        else if (/deck|pitch.?deck/i.test(label)) val = data.deck;
        else if (/round|raising/i.test(label)) val = data.round;
        else if (/valuation/i.test(label)) val = data.valuation;
        else if (/stage/i.test(label)) val = data.stage;
        else if (/founded|start|when/i.test(label)) val = data.founded;
        else if (/pitch|describe|what.?do|building|about/i.test(label)) val = data.pitch;
        else if (/problem/i.test(label)) val = data.problem;
        else if (/solution|how.?solve/i.test(label)) val = data.solution;
        else if (/traction|progress|milestone/i.test(label)) val = data.traction;
        else if (/compet/i.test(label)) val = data.competitors;
        else if (/why.?you|founder.?fit|team|background/i.test(label)) val = data.whyYou;
        else if (/market.?size|tam|market/i.test(label)) val = data.market;
        else if (/revenue|money|business.?model/i.test(label)) val = data.revenue;
        else if (/referr|hear|encourage|who.?told/i.test(label)) val = data.referral || '';

        if (val) {
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        }
      }

      // Try selecting fintech/financial radio/checkbox
      const labels = document.querySelectorAll('label, span, div');
      for (const l of labels) {
        const t = l.innerText?.trim()?.toLowerCase() || '';
        if (t === 'fintech' || t === 'financial services' || t === 'financial infrastructure') {
          l.click();
        }
        if (t === 'c-corp' || t === 'c-corporation') l.click();
        if (t === 'founder') l.click();
        if (t === 'seed' || t === 'pre-seed') l.click();
        if (t === 'united states' || t === 'usa') l.click();
      }

      return count;
    }, { ...DATA, referral: program.referral });

    // Also check for iframes (Tally, Typeform, Google Forms)
    const iframes = await pg.evaluate(() =>
      [...document.querySelectorAll('iframe')].map(f => f.src).filter(s => s && !s.includes('recaptcha'))
    );

    if (iframes.length > 0 && filled < 3) {
      console.log(`[${program.name}] Has iframe form: ${iframes[0].slice(0, 60)}`);
      // Try filling inside iframe
      try {
        const frame = pg.frameLocator('iframe').first();
        await frame.locator('input').first().fill(DATA.email, { timeout: 3000 });
        console.log(`[${program.name}] Iframe email filled`);
      } catch {}
    }

    console.log(`[${program.name}] FILLED ${filled} fields — tab open`);
    return filled > 0 ? 'filled' : 'no-form';

  } catch (e) {
    console.log(`[${program.name}] ERROR: ${e.message?.slice(0, 80)}`);
    return 'error';
  }
}

async function main() {
  console.log(`\n=== AURAMAXING Batch Application Filler ===`);
  console.log(`Programs to process: ${PROGRAMS.length}`);
  console.log(`Starting...\n`);

  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, { timeout: 10000 });

  const results = { filled: [], skipped: [], errors: [] };

  for (let i = 0; i < PROGRAMS.length; i++) {
    const prog = PROGRAMS[i];
    console.log(`\n[${i + 1}/${PROGRAMS.length}] ${prog.name}`);

    const status = await fillForm(browser, prog);

    if (status === 'filled') results.filled.push(prog.name);
    else if (status === 'skip-404' || status === 'no-form') results.skipped.push(prog.name);
    else results.errors.push(prog.name);

    // Small delay between tabs to not overwhelm Chrome
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n\n=== RESULTS ===`);
  console.log(`Filled: ${results.filled.length} — ${results.filled.join(', ')}`);
  console.log(`Skipped: ${results.skipped.length} — ${results.skipped.join(', ')}`);
  console.log(`Errors: ${results.errors.length} — ${results.errors.join(', ')}`);
  console.log(`\nTotal tabs open: ${results.filled.length + 6} (including YC, a16z, Thiel, Alliance, Village Global, Precursor)`);
  console.log(`ALL tabs left open for review. Nothing submitted.`);
}

main().catch(e => console.error('Fatal:', e.message)).finally(() => process.exit(0));
