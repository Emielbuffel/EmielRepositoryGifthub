// Automatic categorisation for (mostly Dutch / Belgian) transaction descriptions.
import { normalize } from './util.js';

// Each rule: [categoryId, type, [keywords...]]. Keywords are matched on the
// normalised description (lowercase, no accents). Order matters: first match wins.
export const BUILTIN_RULES = [
  // ---- transfers between own accounts (must come first) ----
  ['card-payment', 'transfer', ['aflossing kredietkaart', 'betaling kredietkaart', 'terugbetaling kredietkaart', 'uw betaling', 'betaling ontvangen', 'payment received', 'paiement recu', 'beobank mastercard', 'afrekening kredietkaart', 'mastercard afrekening', 'visa afrekening', 'domiciliering beobank', 'beobank nv']],
  ['to-savings', 'transfer', ['naar spaarrekening', 'spaarrekening', 'spaarplan', 'beleggingsplan', 'pensioensparen', 'pensioenspaarfonds', 'bolero', 'degiro', 'keytrade', 'trade republic', 'saxo', 'meDirect'.toLowerCase(), 'easyvest', 'beleggingsrekening']],
  ['transfer', 'transfer', ['eigen rekening', 'overschrijving naar eigen', 'interne overschrijving', 'tussen eigen rekeningen', 'virement interne']],

  // ---- income ----
  ['salary', 'income', ['loon', 'wedde', 'salaris', 'salaire', 'bezoldiging', 'eindejaarspremie', 'vakantiegeld', 'dertiende maand', 'maaltijdcheques', 'netto loon', 'payroll', 'remuneration', 'sd worx', 'securex', 'partena', 'acerta', 'liantis', 'group s']],
  ['rental', 'income', ['huurinkomsten', 'huur ontvangen', 'huurgelden', 'huur appartement', 'huur woning', 'loyer']],
  ['benefits', 'income', ['groeipakket', 'kinderbijslag', 'fons', 'kidslife', 'infino', 'parentia', 'myfamily', 'werkloosheidsuitkering', 'rva', 'hvw', 'capac', 'uitkering', 'ziekte-uitkering', 'vdab']],
  ['interest', 'income', ['creditintrest', 'intrest spaarrekening', 'getrouwheidspremie', 'basisrente', 'dividend', 'coupon']],
  ['refunds', 'income', ['terugbetaling', 'remboursement', 'refund', 'teruggave', 'tussenkomst mutualiteit', 'terugstorting']],

  // ---- expenses ----
  ['housing', 'expense', ['huur', 'hypotheek', 'woonlening', 'woonkrediet', 'aflossing lening', 'lening', 'syndicus', 'gemeenschappelijke kosten', 'loyer', 'pret hypothecaire']],
  ['utilities', 'expense', ['engie', 'electrabel', 'luminus', 'totalenergies power', 'total energies', 'eneco', 'mega', 'bolt energie', 'octa+', 'fluvius', 'farys', 'de watergroep', 'pidpa', 'water-link', 'aquafin', 'energie', 'elektriciteit', 'stookolie', 'mazout']],
  ['groceries', 'expense', ['colruyt', 'delhaize', 'ad delhaize', 'aldi', 'lidl', 'carrefour', 'albert heijn', 'jumbo', 'spar', 'okay', 'bio-planet', 'bioplanet', 'intermarche', 'match', 'cora', 'louis delhaize', 'proxy delhaize', 'shop&go', 'slagerij', 'bakkerij', 'bakker', 'beenhouwerij', 'kruidvat', 'action', 'hello fresh', 'hellofresh', 'picnic', 'collect&go']],
  ['restaurants', 'expense', ['restaurant', 'resto', 'brasserie', 'bistro', 'cafe', 'taverne', 'frituur', 'friterie', 'pizza', 'pizzeria', 'sushi', 'kebab', 'mcdonald', 'burger king', 'quick', 'kfc', 'domino', 'deliveroo', 'uber eats', 'ubereats', 'takeaway', 'just eat', 'starbucks', 'panos', 'exki', 'le pain quotidien', 'lunch garden', 'bar ', 'koffie', 'ijssalon']],
  ['transport', 'expense', ['nmbs', 'sncb', 'de lijn', 'stib', 'mivb', 'tec ', 'uber', 'bolt.eu', 'taxi', 'blue-bike', 'velo antwerpen', 'cambio', 'poppy', 'parking', 'interparking', 'qpark', 'q-park', '4411', 'yellowbrick', 'eurostar', 'thalys']],
  ['car', 'expense', ['shell', 'esso', 'q8', 'texaco', 'total ', 'totalenergies', 'lukoil', 'dats 24', 'dats24', 'gabriels', 'maes', 'octa', 'g&v', 'tankstation', 'brandstof', 'carwash', 'car wash', 'garage', 'autokeuring', 'aibv', 'bandencentrale', 'vab', 'touring', 'verkeersbelasting', 'tesla supercharger', 'allego', 'laadpaal']],
  ['insurance', 'expense', ['verzekering', 'assurance', 'ag insurance', 'ethias', 'axa', 'allianz', 'baloise', 'p&v', 'pv verzekeringen', 'dkv', 'kbc verzekering', 'belfius insurance', 'federale verzekering', 'vivium', 'yuzzu', 'corona direct', 'polis']],
  ['health', 'expense', ['apotheek', 'pharmacie', 'pharmacy', 'dokter', 'huisarts', 'tandarts', 'kinesist', 'ziekenhuis', 'uz ', 'az ', 'ziekenfonds', 'mutualiteit', 'cm ', 'helan', 'solidaris', 'opticien', 'pearle', 'hans anders', 'labo']],
  ['telecom', 'expense', ['proximus', 'telenet', 'orange', 'base ', 'mobile vikings', 'scarlet', 'voo', 'digi ', 'hey!', 'youfone', 'edpnet']],
  ['subscriptions', 'expense', ['netflix', 'spotify', 'disney', 'disney+', 'apple.com/bill', 'apple.com', 'itunes', 'icloud', 'google one', 'google storage', 'youtube premium', 'amazon prime', 'prime video', 'streamz', 'hbo', 'max.com', 'viaplay', 'deezer', 'audible', 'chatgpt', 'openai', 'claude.ai', 'anthropic', 'microsoft 365', 'adobe', 'dropbox', 'standaard', 'het nieuwsblad', 'de tijd', 'mediahuis', 'dpg media', 'abonnement', 'basic-fit', 'basic fit', 'jims', 'fitness', 'playstation', 'xbox', 'nintendo', 'patreon']],
  ['shopping', 'expense', ['bol.com', 'amazon', 'coolblue', 'mediamarkt', 'media markt', 'vanden borre', 'krefel', 'fnac', 'ikea', 'hema', 'zeeman', 'aliexpress', 'temu', 'shein', 'standaard boekhandel', 'club ', 'dreamland', 'paypal', 'apple store', 'gamma', 'brico', 'hubo', 'leroy merlin']],
  ['clothing', 'expense', ['zara', 'h&m', 'h & m', 'primark', 'c&a', 'jbc', 'zalando', 'bershka', 'pull&bear', 'mango', 'decathlon', 'torfs', 'schoenen', 'e5 mode', 'wibra', 'vinted', 'snipes', 'nike', 'adidas']],
  ['kids', 'expense', ['kinderopvang', 'creche', 'kribbe', 'onthaalouder', 'school', 'schoolrekening', 'naschoolse', 'speelplein', 'oppas', 'kinderdagverblijf', 'babyshop', 'dreambaby', 'kiabi']],
  ['leisure', 'expense', ['kinepolis', 'cinema', 'bioscoop', 'ticketmaster', 'theater', 'concert', 'museum', 'sportclub', 'zwembad', 'padel', 'tennis', 'golf', 'pretpark', 'plopsa', 'walibi', 'pairi daiza', 'bowling']],
  ['travel', 'expense', ['booking.com', 'airbnb', 'hotel', 'ryanair', 'brussels airlines', 'tui', 'transavia', 'easyjet', 'vueling', 'klm', 'lufthansa', 'expedia', 'sunweb', 'center parcs', 'jetair', 'vakantie', 'charleroi airport', 'brussels airport']],
  ['home', 'expense', ['aveve', 'tuincentrum', 'intratuin', 'casa ', 'maisons du monde', 'jysk', 'leen bakker', 'kwantum', 'brico', 'schoonmaak', 'poetsdienst', 'dienstencheques', 'pluxee', 'sodexo dienstencheques']],
  ['personal', 'expense', ['kapper', 'kapsalon', 'coiffure', 'barber', 'ici paris', 'yves rocher', 'rituals', 'douglas', 'nagelstudio', 'schoonheidsinstituut']],
  ['gifts', 'expense', ['gift', 'cadeau', 'geschenk', 'gift aan', 'donatie', 'schenking', 'rode kruis', 'unicef', 'artsen zonder grenzen', '11.11.11', 'kom op tegen kanker']],
  ['education', 'expense', ['inschrijvingsgeld', 'cursus', 'opleiding', 'universiteit', 'hogeschool', 'kuleuven', 'ugent', 'udemy', 'coursera']],
  ['pets', 'expense', ['dierenarts', 'dierenspeciaalzaak', 'tom&co', 'maxi zoo', 'zooplus', 'brustor']],
  ['taxes', 'expense', ['fod financien', 'spf finances', 'belastingen', 'personenbelasting', 'onroerende voorheffing', 'vlabel', 'gemeentebelasting', 'provinciebelasting', 'btw', 'boete', 'retributie']],
  ['fees', 'expense', ['beheerskosten', 'beheerskost', 'jaarbijdrage', 'kaartbijdrage', 'debetrente', 'debetintrest', 'intrest kredietkaart', 'kosten rekening', 'aanrekening kosten', 'bankkosten', 'frais', 'wisselkoers', 'koersverschil', 'commissie', 'aanmaningskost', 'verwijlintrest']],
  ['cash', 'expense', ['geldopname', 'geldafhaling', 'cash withdrawal', 'retrait', 'bancontact geldautomaat', 'atm', 'batopin']],
];

/**
 * Suggest a category + type for a description.
 * @param {string} description
 * @param {Array} userRules learned rules [{pattern, categoryId, type}]
 * @param {{accountType?: string, sign?: number}} ctx
 * @returns {{categoryId: string, type: string, matched: string|null}}
 */
export function categorize(description, userRules = [], ctx = {}) {
  const text = ' ' + normalize(description) + ' ';
  // user-learned rules win
  for (const r of userRules) {
    if (r.pattern && text.includes(normalize(r.pattern))) return { categoryId: r.categoryId, type: r.type, matched: r.pattern };
  }
  // Paying the Beobank (or any) credit card from a current account is a transfer, not spending
  if (ctx.accountType !== 'credit' && /\b(beobank|kredietkaart|creditcard|credit card)\b/.test(text)) {
    return { categoryId: 'card-payment', type: 'transfer', matched: 'credit card' };
  }
  for (const [categoryId, type, words] of BUILTIN_RULES) {
    for (const w of words) {
      if (!w) continue;
      // short keywords need word boundaries to avoid false hits
      const hit = w.trim().length <= 5 ? new RegExp(`(^|[^a-z0-9])${escapeRe(w.trim())}([^a-z0-9]|$)`).test(text) : text.includes(w);
      if (!hit) continue;
      // A card repayment seen on the credit card itself, or a salary/refund with a minus sign, may need fixing
      if (type === 'income' && ctx.sign === -1) continue;
      if (type === 'expense' && ctx.sign === 1) {
        if (categoryId === 'housing' && /huur|loyer/.test(text)) return { categoryId: 'rental', type: 'income', matched: w };
        continue;
      }
      return { categoryId, type, matched: w };
    }
  }
  if (ctx.sign === 1) return { categoryId: 'other-inc', type: 'income', matched: null };
  return { categoryId: 'other-exp', type: 'expense', matched: null };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Derive a short, reusable keyword from a description to learn a rule from. */
export function merchantKey(description) {
  const n = normalize(description)
    .replace(/\b(betaling|aankoop|bancontact|maestro|mastercard|visa|debit|debetkaart|kaart|card|contactloos|apple pay|google pay|domiciliering|europese|overschrijving|instant|via|met|nr|ref|referentie|mededeling|be\d{2}[\d ]+)\b/g, ' ')
    .replace(/\d{2}[/.-]\d{2}([/.-]\d{2,4})?/g, ' ')
    .replace(/[^a-z&+.' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = n.split(' ').filter((w) => w.length > 1);
  return words.slice(0, 2).join(' ');
}
