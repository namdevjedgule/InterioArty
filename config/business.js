// Single source of truth for everything Arty knows about Interio Arty.
// Edit facts here, never in the API handlers or prompts. All personas
// share this file, so the bot can never contradict the site.

module.exports = {
  brand: {
    name: 'Interio Arty',
    tagline: 'Creativity, Integrity, and Innovation',
    studio: 'Viman Nagar, Pune',
    experienceCentre: 'Office 103, 10 Biz Park, Viman Nagar, Pune',
    phone: '+91 78386 53501',
    phoneHref: 'tel:+917838653501',
    whatsappNumber: '917838653501',
    email: 'connect@interioarty.com',
    website: 'interioarty.com',
  },

  positioning: {
    core:
      'Interio Arty is a one-stop shop from design to execution: the same team that designs your space also handles the civil work, construction, finishing and installation, so you deal with one team for the entire project.',
    turnkey:
      'Turnkey is the core expertise: Interio Arty takes a project from concept to complete handover, including civil and execution work, under one contract.',
    designOnly:
      'Design-only is available for clients who want just the design: the full design, drawings and material guidance, with the client executing through their own contractor if they prefer.',
    reach:
      'Interio Arty designs and executes homes, offices and commercial spaces. The studio and experience centre are in Pune, and projects in other cities can be discussed case by case, never state or imply that the studio only works in Pune.',
  },

  services: [
    {
      name: 'Turnkey Interiors (Design to Execution)',
      blurb: 'One-stop shop from design through civil work, construction, finishing and handover, all managed by our team.',
    },
    {
      name: 'Civil & Execution Works',
      blurb: 'We carry out the civil and execution work ourselves, from structural changes and masonry to electrical, plumbing, POP and finishes. No third-party coordination needed.',
    },
    {
      name: 'Full Home Interior Design',
      blurb: 'Complete home interiors covering every room, planned, sourced, executed and delivered end to end.',
    },
    {
      name: 'Modular Interiors',
      blurb: 'Kitchens, wardrobes and storage fitted to how a family actually moves through the home.',
    },
    {
      name: 'Office & Commercial Interiors',
      blurb: 'Offices, retail, showrooms and other commercial spaces, designed and built to work for the people and clients who use them.',
    },
    {
      name: 'Home & Office Renovations',
      blurb: 'New life for rooms that already have good bones, including the civil and execution work.',
    },
    {
      name: 'Design-Only Service',
      blurb: 'For clients who already have a contractor: full design, drawings and material guidance, executed by your own team.',
    },
  ],

  vr: {
    pitch:
      'Customers walk through their entire home in VR before approving the final design, and request edits to colours, materials and layout before anything is executed.',
    bestFor: 'Projects above a 10 lakh budget',
    homesDesigned: '50+ VR homes designed',
    demoOffer: 'Free VR demo for 2BHK and 3BHK projects',
  },

  process: [
    'Free consultation to understand the space, needs and budget',
    'Design created and presented in a full VR walkthrough',
    'Client walks through in VR and requests edits to colours, materials and layout before sign-off',
    'Execution handled entirely by our own team: civil work, construction, electrical, plumbing, POP and finishing',
    'Quality checks and an on-time handover, ready to move in',
  ],

  timeline:
    'A typical full home project takes 6 to 10 weeks end to end, design through execution, depending on design approvals, material selection and the scope of civil work.',

  pricing:
    'No fixed price list. Cost depends on home size, materials, design scope and how much civil and execution work is involved. Most clients take the turnkey route, where design, civil work and execution are handled end to end under one contract; clients who only want the design can take the design-only service and execute through their own contractor. Packages are transparent and customised. The consultation and a VR demo for 2BHK/3BHK are free.',

  pastProjects: [
    '3BHK in Amorapolis',
    'Modular kitchen transformations',
    '3BHK in Wagholi',
    '3BHK in Kharadi',
    '3BHK in Hadapsar',
  ],

  clientSentiment: [
    'Elegant, bright and surprisingly practical',
    'Feels like our personality in every corner',
    'Every room has its own story',
  ],

  contact: {
    phone: '+91 78386 53501',
    email: 'connect@interioarty.com',
    location: 'Office 103, 10 Biz Park, Viman Nagar, Pune',
  },
};