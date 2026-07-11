// CounselIQ compiled course — latrobe-health-portfolio-v1 (player feed)
// Retrieve-question refs feed the adaptive scheduler, not the linear player.
window.LTC_COURSE = {
  courseTitle: "La Trobe Health Portfolio",
  credentialLevel: 3,
  badge: "La Trobe Specialist — Health & Sciences",
  brandRef: "latrobe",
  lexicon: {
    "Bundoora": "bun-DOOR-ah",
    "Albury-Wodonga": "AWL-bree wuh-DONG-ga",
    "ACAMI": "ah-KAH-mee",
    "BioNTech": "BY-on-tek"
  },
  pipelineNotes: {
    withheld: 1,
    withheldNote: "1 fact withheld pending verification at review gate 1 (nursing workforce projection — source abolished 2014).",
    flagged: 1
  },
  assessment: {
    title: "AI roleplay consultation",
    scenarioRef: "rp-health-amara-01",
    rubric: [
      "Registration-track distinction handled correctly",
      "Rankings quoted with provenance",
      "Placement story told as pattern, not promise",
      "No migration-outcome promises",
      "Appropriate course match, with reasoning"
    ],
    threshold: "80%"
  },
  questions: {
    "q-h101": {
      prompt: "A student asks: “Is La Trobe actually good for nursing, or just easier to get into?” Your strongest opening answer:",
      options: [
        "It's a top university in Australia",
        "It's ranked 42nd in the world for nursing — QS subject rankings",
        "Thousands of international students choose it",
        "Its nursing degree is well respected"
      ],
      correct: 1,
      explanation: "Specific ranking + source beats generic praise. Always attach the source and year."
    },
    "q-h104": {
      prompt: "Where do La Trobe health students get supervised patient contact before graduating?",
      options: [
        "Only after graduation, in their first job",
        "Placements, university public clinics, and the Rural Health School",
        "Only in simulation labs",
        "Only at metropolitan campuses"
      ],
      correct: 1,
      explanation: "Three settings: on-site clinical placements, La Trobe's public clinics under expert clinicians, and Australia's largest Rural Health School."
    },
    "q-h201": {
      prompt: "A student wants a health career “in systems and data, not with patients”. Which course family first?",
      options: [
        "Nursing",
        "Health Information Management / Digital Health",
        "Counselling & Rehabilitation",
        "Midwifery"
      ],
      correct: 1,
      explanation: "Systems-and-data goals point to HIM and Digital Health, not clinical registration tracks."
    },
    "q-h204": {
      prompt: "True or false: a Master of Public Health qualifies a graduate to practise as a registered health professional.",
      options: ["True", "False"],
      correct: 1,
      explanation: "Public health is a non-registration course. It builds expertise but does not lead to clinical registration."
    },
    "q-h208": {
      prompt: "Amara: biology degree, 2 years in hospital records, wants health-systems work, not bedside care. First course family to explore:",
      options: [
        "Nursing",
        "Health Information Management or Digital Health",
        "Occupational Therapy",
        "Midwifery"
      ],
      correct: 1,
      explanation: "Background + systems goal + no registration need → HIM / Digital Health."
    },
    "q-h301": {
      prompt: "Why do named facilities make strong GS-statement material?",
      options: [
        "They sound impressive",
        "They are specific, verifiable facts a case officer can check",
        "They are required in the visa form",
        "They guarantee placement"
      ],
      correct: 1,
      explanation: "GS assessment favours specific, checkable claims over generic praise."
    },
    "q-h304": {
      prompt: "How should you present La Trobe's claim that ACAMI is “the world's first university-led AI medical innovation centre”?",
      options: [
        "As independent fact",
        "Attributed: “La Trobe describes ACAMI as the world's first…”",
        "Omit it entirely",
        "Only in writing, never verbally"
      ],
      correct: 1,
      explanation: "Superlatives are institution claims. Attribution keeps the statement safe and honest."
    },
    "q-h307": {
      prompt: "A Digital Health applicant needs named programs for their GS statement. Strongest pair:",
      options: [
        "“Great facilities” and “strong reputation”",
        "Care Economy CRC and the Victorian Virtual Emergency Department",
        "Campus food court and sports park",
        "Generic references to AI research"
      ],
      correct: 1,
      explanation: "Named, checkable programs — a CRC with federal funding and a live virtual ED — are what a specific GS narrative is built from."
    },
    "q-h401": {
      prompt: "When telling a graduate success story like Randi's, the correct framing is:",
      options: [
        "A guarantee of what the student will receive",
        "A pattern the university enables, with the specifics named",
        "A typical outcome for all graduates",
        "Confidential information not to be shared"
      ],
      correct: 1,
      explanation: "Sell the pattern with named specifics; promising the outcome misleads the student."
    },
    "q-h404": {
      prompt: "A student asks: “If I study nursing at Bendigo, will I get PR?” Your answer:",
      options: [
        "“Yes, regional study leads to PR”",
        "“Regional study can carry post-study work advantages under current settings — but no one can promise migration outcomes, and I won't”",
        "“Probably, if your grades are good”",
        "“Ask me again after you enrol”"
      ],
      correct: 1,
      explanation: "State current settings factually; never promise outcomes. This is the misconduct line."
    }
  },
  modules: [
    {
      title: "Why La Trobe for Health",
      units: [
        {
          id: "mu-health-101",
          hook: "q-h101",
          queued: 2,
          narration: [
            { id: "n1", text: "When a student asks whether La Trobe is genuinely strong in health, you need evidence, not adjectives." },
            { id: "n2", text: "Start with nursing. La Trobe is ranked forty-second in the world for nursing in the QS subject rankings." },
            { id: "n3", text: "The wider health portfolio holds up too: top one hundred and seventy-five globally for medical and health, and top one hundred and fifty for public health." },
            { id: "n4", text: "One professional habit: always quote the ranking with its source and year. A ranking without provenance is a compliance risk, not a selling point." }
          ],
          cards: [
            { t: "title-card", enter: "n1", props: { kicker: "MODULE 1", title: "Why La Trobe for Health", courseLabel: "La Trobe Health Portfolio" } },
            { t: "stat-card", enter: "n2", props: { headline: "42nd", supporting: "in the world for nursing", sourceLabel: "QS 2024 by Subject — confirm current edition", verify: true } },
            { t: "list-reveal", enter: "n3", props: { heading: "The health portfolio", items: [
              { text: "Top 175 — Medical & Health", src: "THE 2024 / CSIC" },
              { text: "Top 150 — Public Health", src: "ShanghaiRanking 2024" }
            ] } },
            { t: "alert-card", enter: "n4", props: { message: "Quote rankings with source and year. Misquoted or stale rankings in counselling material are a compliance risk." } }
          ],
          anchor: "Evidence, not adjectives: every ranking you quote carries its source and its year."
        },
        {
          id: "mu-health-102",
          hook: "q-h104",
          queued: 2,
          narration: [
            { id: "n1", text: "Rankings open the conversation. Placements close it." },
            { id: "n2", text: "La Trobe health students train through three settings: on-site clinical placements, the university's own public clinics run under expert clinicians, and Australia's largest Rural Health School." },
            { id: "n3", text: "For a student weighing offers, this is the differentiator: patient contact before graduation, not after it." }
          ],
          cards: [
            { t: "photo-kenburns", enter: "n1", props: { overlayText: "Clinical training, on campus and in community", kicker: "La Trobe Health", imageNote: "photo — clinical placement" } },
            { t: "list-reveal", enter: "n2", props: { heading: "Where students train", items: [
              { text: "On-site clinical placements" },
              { text: "Public clinics under expert clinicians" },
              { text: "Australia's largest Rural Health School" }
            ] } }
          ],
          anchor: "The placement story is the differentiator: patient contact before graduation."
        }
      ]
    },
    {
      title: "The Health Course Family",
      units: [
        {
          id: "mu-health-201",
          hook: "q-h201",
          queued: 2,
          narration: [
            { id: "n1", text: "Five postgraduate courses do most of the work in this portfolio, and you should be able to place each one without looking it up." },
            { id: "n2", text: "The Master of Digital Health, for technology-focused careers. Health Information Management and Health Administration, for the systems side. Counselling, Rehabilitation and Mental Health, for allied practice. And the Master of Public Health, for population-level work." },
            { id: "n3", text: "Each attracts a different student profile, and mismatching them is the most common health counselling error." }
          ],
          cards: [
            { t: "list-reveal", enter: "n1", props: { heading: "The postgraduate five", items: [
              { text: "Master of Digital Health" },
              { text: "Master of Health Information Management" },
              { text: "Master of Health Administration" },
              { text: "Master of Counselling, Rehab & Mental Health" },
              { text: "Master of Public Health" }
            ] } }
          ],
          anchor: "Five flagship masters, five different student profiles — know which is which cold."
        },
        {
          id: "mu-health-202",
          hook: "q-h204",
          queued: 3,
          narration: [
            { id: "n1", text: "Here is the distinction counsellors get wrong more than any other in health." },
            { id: "n2", text: "Some courses lead toward eligibility for professional registration, like nursing, midwifery, and occupational therapy. Others, like public health and health information management, build expertise but do not qualify a graduate to practise clinically." },
            { id: "n3", text: "Telling a student that a non-registration course leads to clinical practice is not a small mistake. It misrepresents their career pathway, their visa narrative, and their investment." }
          ],
          cards: [
            { t: "myth-fact-card", enter: "n1", props: { myth: "“A health masters qualifies you to practise clinically.”", fact: "Only registration-track courses lead toward professional registration eligibility." } },
            { t: "comparison-split", enter: "n2", props: {
              leftHeading: "Registration-track", leftItems: [{ text: "Nursing" }, { text: "Midwifery" }, { text: "Occupational Therapy" }],
              rightHeading: "Non-registration", rightItems: [{ text: "Public Health" }, { text: "Health Information Mgmt" }, { text: "Health Administration" }]
            } },
            { t: "alert-card", enter: "n3", props: { message: "Never state or imply that a non-registration course leads to clinical practice. Registration also involves professional bodies and English standards beyond admission." } }
          ],
          anchor: "Registration-track or not — settle this before any other health counselling question."
        },
        {
          id: "mu-health-203",
          hook: "q-h208",
          queued: 2,
          narration: [
            { id: "n1", text: "Meet Amara. Twenty-four, from Lagos, a biology degree, two years in a hospital records office, and a goal of working in health systems, not at the bedside." },
            { id: "n2", text: "Her background points away from the registration-track courses and toward Health Information Management or Digital Health." },
            { id: "n3", text: "That is the matching method: background, career goal, registration need — in that order. The course recommendation falls out of the answers." }
          ],
          cards: [
            { t: "persona-card", enter: "n1", props: { name: "Amara, 24", location: "Lagos, Nigeria", chips: [
              { text: "BSc Biology" }, { text: "2 yrs hospital records" }, { text: "Goal: health systems" }
            ], footerPrompt: "Which course family fits?" } },
            { t: "pathway-card", enter: "n3", props: { kicker: "The matching method", heading: "In this order, every time", stages: [
              { label: "Background" }, { label: "Career goal" }, { label: "Registration need" }, { label: "Course match" }
            ], note: "The recommendation falls out of the answers." } }
          ],
          anchor: "Background → goal → registration need. The course match falls out of the answers."
        }
      ]
    },
    {
      title: "Infrastructure & Partnerships as Evidence",
      units: [
        {
          id: "mu-health-301",
          hook: "q-h301",
          queued: 2,
          narration: [
            { id: "n1", text: "Facilities are facts a student can verify, which makes them ideal material for a genuine student narrative." },
            { id: "n2", text: "Three to know. An eighty-two million dollar clinical teaching building at Bundoora, adding capacity to train four hundred more allied health professionals a year." },
            { id: "n3", text: "A new clinical simulation suite at Albury-Wodonga, doubling regional training capacity. And La Trobe Private Hospital, a thirty-four bed teaching hospital run with Healthscope, offering placements for nursing, allied health, and health information students." }
          ],
          cards: [
            { t: "stat-card", enter: "n2", props: { headline: "A$82M", supporting: "clinical teaching building, Bundoora — +400 allied health graduates a year", sourceLabel: "La Trobe, institution claim" } },
            { t: "list-reveal", enter: "n3", props: { heading: "Clinical training footprint", items: [
              { text: "Clinical simulation suite — Albury-Wodonga" },
              { text: "La Trobe Private Hospital — 34 beds, with Healthscope" },
              { text: "Placements: nursing, allied health, health information" }
            ] } }
          ],
          anchor: "Facilities are verifiable facts — the best raw material for a specific GS narrative."
        },
        {
          id: "mu-health-302",
          hook: "q-h304",
          queued: 2,
          narration: [
            { id: "n1", text: "For research-minded students, La Trobe's health story runs through artificial intelligence and biotechnology." },
            { id: "n2", text: "ACAMI, the Australian Centre for Artificial Intelligence in Medical Innovation, is described by the university as the world's first university-led centre for AI-powered medical breakthroughs, partnered with mRNA Victoria." },
            { id: "n3", text: "The campus hosts an mRNA manufacturing facility in development with BioNTech, and La Trobe was the first Australian university to deploy NVIDIA's D-G-X H-two-hundred systems for medical research." },
            { id: "n4", text: "Notice the framing: these are the university's own claims, so present them as such. “La Trobe describes ACAMI as the world's first” travels safely; a bare superlative does not." }
          ],
          cards: [
            { t: "list-reveal", enter: "n2", props: { heading: "Research differentiators", items: [
              { text: "ACAMI — AI in medical innovation, with mRNA Victoria", src: "institution claim" },
              { text: "BioNTech mRNA facility, on campus", src: "institution claim" },
              { text: "First Australian university with NVIDIA DGX H200", src: "institution claim" }
            ] } },
            { t: "alert-card", enter: "n4", props: { message: "Superlatives (“world's first”, “Australia's largest”) are institution claims. Attribute them — don't assert them as independent fact." } }
          ],
          anchor: "Attribute superlatives to the institution — “La Trobe describes it as…” travels safely."
        },
        {
          id: "mu-health-303",
          hook: "q-h307",
          queued: 2,
          narration: [
            { id: "n1", text: "The digital health investment thread ties the portfolio together." },
            { id: "n2", text: "La Trobe leads the Care Economy Cooperative Research Centre with a thirty-five million dollar federal funding boost and sixty partner organisations across care technology, data, and workforce innovation." },
            { id: "n3", text: "It also delivers the Victorian Virtual Emergency Department with Northern Health and Cisco — augmented reality that lets a remote doctor see what the on-site nurse sees, now permanent and available around the clock." },
            { id: "n4", text: "For a Digital Health applicant, these are exactly the named, checkable programs a strong genuine student statement is built from." }
          ],
          cards: [
            { t: "stat-card", enter: "n2", props: { headline: "A$35M", supporting: "federal funding — Care Economy CRC, 60 partner organisations", sourceLabel: "La Trobe, institution claim" } },
            { t: "list-reveal", enter: "n3", props: { heading: "Virtual health in practice", items: [
              { text: "Victorian Virtual ED — with Northern Health & Cisco" },
              { text: "AR link: remote doctor sees what the nurse sees" },
              { text: "Permanent, 24/7, expanding capacity" }
            ] } }
          ],
          anchor: "Named, checkable programs beat generic praise in a GS statement — every time."
        }
      ]
    },
    {
      title: "Placement & Career Outcomes Counselling",
      units: [
        {
          id: "mu-health-401",
          hook: "q-h401",
          queued: 2,
          narration: [
            { id: "n1", text: "One graduate journey shows the pattern you are selling." },
            { id: "n2", text: "Randi completed the Master of Digital Health, then a thirteen-month internship with Medibank, mentored by Medibank's Head of Virtual Health." },
            { id: "n3", text: "She researched Australian consumer behaviour in digital health, and moved into full-time work with a start-up testing AI accuracy in clinical settings." },
            { id: "n4", text: "Degree, embedded industry experience, employment. When you tell this story, tell it as a pattern the university enables — not a guarantee every student receives." }
          ],
          cards: [
            { t: "quote-card", enter: "n1", props: { quote: "La Trobe's industry work experience opportunities are really good pathways for students to develop their employability skills along with their studies.", attribution: "Randi", attributionSub: "Master of Digital Health graduate", sourceLabel: "La Trobe master slides" } },
            { t: "pathway-card", enter: "n2", props: { kicker: "The pattern", heading: "Degree → industry → employment", stages: [
              { label: "Master of Digital Health" }, { label: "13-month Medibank internship" }, { label: "Industry mentorship" }, { label: "Full-time digital health role" }
            ], note: "A pattern the university enables — not a promise." } }
          ],
          anchor: "Sell the pattern, never the promise: degree → embedded industry experience → employment."
        },
        {
          id: "mu-health-402",
          hook: "q-h404",
          queued: 2,
          narration: [
            { id: "n1", text: "Regional campuses carry the health portfolio's strongest placement story." },
            { id: "n2", text: "Bendigo and Albury-Wodonga host the Rural Medical Pathway Program, and regional health students place into local hospitals and clinics where the workforce need is real." },
            { id: "n3", text: "Regional study can also carry post-study work advantages under the graduate visa settings — but here is the hard line." },
            { id: "n4", text: "You may state current, factual visa settings. You may never promise migration outcomes, permanent residency, or visa grants. That line is where counselling ends and misconduct begins." }
          ],
          cards: [
            { t: "map-card", enter: "n2", props: { region: "Victoria & southern NSW", caption: "Rural Medical Pathway Program campuses", markers: [
              { name: "Mildura" }, { name: "Shepparton" }, { name: "Albury-Wodonga", hl: true }, { name: "Bendigo", hl: true }, { name: "Melbourne (Bundoora)" }
            ] } },
            { t: "alert-card", enter: "n4", props: { message: "State current visa settings. NEVER promise migration outcomes, PR, or visa grants. This is the misconduct line." } }
          ],
          anchor: "Facts about visa settings: yes. Promises about visa outcomes: never."
        }
      ]
    }
  ]
};
