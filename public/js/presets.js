/**
 * CultureRisk AI — evaluation presets.
 *
 * Realistic development-slate scenarios. The fourth is a deliberately risky
 * "X meets Y" hybrid that shows the comp stress test catching an audience
 * that may not exist.
 */

export const PRESETS = [
  {
    id: 'cyberpunk',
    name: 'Cyberpunk noir',
    title: 'NEO-OSAKA REQUIEM',
    anchors: ['Blade Runner 2049', 'Ghost in the Shell'],
    budgetMillions: 145,
    domains: ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:destination'],
    script:
      'LOGLINE: In a rain-drenched 2091 Neo-Osaka, a disgraced memory-forensics detective discovers that the synthetic witness she is hunting holds the only surviving copy of her late daughter\'s consciousness.\n\n' +
      'TONE: Slow-burn, atmospheric, synth-driven score. Brutalist megastructures, neon haze, philosophical stakes about identity and memory.\n' +
      'RELEASE WINDOW: Q4 premium-format (IMAX / Dolby). RATING TARGET: R.',
  },
  {
    id: 'royal',
    name: 'Royal period drama',
    title: 'THE REGENT\'S VOICE',
    anchors: ["The King's Speech", 'The Favourite'],
    budgetMillions: 28,
    domains: ['urn:entity:destination', 'urn:entity:brand', 'urn:entity:podcast'],
    script:
      'LOGLINE: In 1937, a reluctant princess-regent must hide a crippling stammer from Parliament while a self-taught Glaswegian elocutionist becomes the most dangerous confidant in the Empire.\n\n' +
      'TONE: Intimate, witty, prestige awards-season drama. Period-accurate interiors; Scottish and London exteriors.\n' +
      'RELEASE WINDOW: Limited platform, November. RATING TARGET: PG-13.',
  },
  {
    id: 'survival',
    name: 'Survival epic',
    title: 'WHITEOUT',
    anchors: ['The Revenant', 'Everest'],
    budgetMillions: 95,
    domains: ['urn:entity:brand', 'urn:entity:destination', 'urn:entity:tv_show'],
    script:
      'LOGLINE: After a whiteout strands her expedition on an Arctic ice shelf, a celebrated mountaineer must lead rival scientists 300 miles across collapsing sea ice before the polar night falls.\n\n' +
      'TONE: Visceral, naturalistic, practical-effects heavy. Premium outdoor gear is narratively central.\n' +
      'RELEASE WINDOW: Late-winter wide release. RATING TARGET: R.',
  },
  {
    id: 'hybrid',
    name: 'Risky hybrid',
    title: 'SING FOR THE DEAD',
    anchors: ['La La Land', 'Hereditary'],
    budgetMillions: 40,
    domains: ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:tv_show'],
    script:
      'LOGLINE: A struggling jazz pianist inherits her grandmother\'s Laurel Canyon house and discovers that every song she writes there summons something that wants to be sung back.\n\n' +
      'TONE: Romantic musical numbers that curdle into grief-horror. Pitched as "La La Land meets Hereditary".\n' +
      'RELEASE WINDOW: October. RATING TARGET: R.',
  },
];
