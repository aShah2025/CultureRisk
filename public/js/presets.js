/**
 * CultureRisk AI — slate presets.
 *
 * Four released films, each run on the comps and premise it was actually
 * pitched on, next to what really happened at the box office. Two hits, two
 * flops: enough to see whether the verdict separates them.
 */

export const PRESETS = [
  {
    id: 'joker',
    name: 'Crime drama',
    title: 'JOKER',
    outcome: '$1.07B worldwide on a $55M budget',
    anchors: ['Taxi Driver', 'The King of Comedy'],
    budgetMillions: 55,
    domains: ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:destination'],
    script:
      'LOGLINE: A failing party clown and aspiring stand-up in a decaying early-1980s Gotham is pushed by a cruel city into violence, and becomes the symbol of an unrest he never planned.\n\n' +
      'TONE: Gritty, unsettling character study. Crime and psychological drama, grounded in a dystopian urban collapse.\n' +
      'RATING TARGET: R.',
  },
  {
    id: 'showman',
    name: 'Period musical',
    title: 'THE GREATEST SHOWMAN',
    outcome: '$435M worldwide on an $84M budget',
    anchors: ['Moulin Rouge!', 'Chicago'],
    budgetMillions: 84,
    domains: ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:tv_show'],
    script:
      'LOGLINE: P.T. Barnum rises from poverty to build a circus empire in nineteenth-century New York, chasing respectability while the troupe he gathers asks what it is worth.\n\n' +
      'TONE: Big original pop musical numbers, period romance and spectacle. A musical for the whole family.\n' +
      'RATING TARGET: PG.',
  },
  {
    id: 'cats',
    name: 'Stage musical',
    title: 'CATS',
    outcome: '~$75M worldwide on a $95M budget',
    anchors: ['Les Misérables', 'Into the Woods'],
    budgetMillions: 95,
    domains: ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:tv_show'],
    script:
      'LOGLINE: One night a year, a tribe of stray cats gathers to compete for the chance at a new life, each performing their story in song.\n\n' +
      'TONE: Sung-through stage musical adapted as a lavish fantasy spectacle. Musical, ensemble, dance-heavy.\n' +
      'RATING TARGET: PG.',
  },
  {
    id: 'carter',
    name: 'Sci-fi adventure',
    title: 'JOHN CARTER',
    outcome: '~$284M worldwide on a $263M budget',
    anchors: ['Avatar', 'Star Wars'],
    budgetMillions: 263,
    domains: ['urn:entity:brand', 'urn:entity:destination', 'urn:entity:tv_show'],
    script:
      'LOGLINE: A Civil War veteran is mysteriously transported to Mars, where the lower gravity makes him a hero and he is pulled into a war between its warring kingdoms.\n\n' +
      'TONE: Swashbuckling interplanetary adventure, big-canvas science fiction with a war backdrop.\n' +
      'RATING TARGET: PG-13.',
  },
];
