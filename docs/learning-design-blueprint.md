# CounselIQ — Learning Design Blueprint

## Mobile-first micro-learning, retention architecture & innovative formats

Companion to the course catalogue. This document covers *how* the seven courses should be delivered, not what they contain. It draws on current research in microlearning, spaced retrieval, and AI simulation training, and deliberately borrows from the Course → Refresher spaced-repetition model already proven at frntlne.

---

## 1. The science, reduced to five design laws

**Law 1 — Short, distributed sessions beat long, massed ones.** The solid base here is the distributed-practice literature (Cepeda et al. 2006 meta-analysis; cognitive load theory, Sweller). The specific "5–15 minute" window quoted across microlearning articles is an industry design convention, not a research-derived threshold — recent microlearning reviews asserting it come from minor journals. The defensible principle: many short sessions with breaks outperform one long session, so our 20–40 min modules become *containers* of 3–7 micro-units of 2–5 minutes each, individually completable.

**Law 2 — Retrieval beats re-reading (the testing effect).** Actively recalling information strengthens memory far more than passive review. Design implication: the quiz is not the end of the lesson — the quiz *is* the lesson. Every micro-unit opens or closes with a retrieval act.

**Law 3 — Spacing beats massing (the forgetting curve).** The spacing effect is among the most replicated findings in memory research (Cepeda et al. 2006; Ebbinghaus, replicated by Murre & Dros 2015). One caveat: there is no single research-blessed interval schedule — Cepeda's work shows optimal gaps scale with how long you need the knowledge retained. The 24h → 3 → 7 → 14-day pattern used below is a reasonable practitioner default (and matches frntlne's proven Refresher cadence), to be treated as a starting point the adaptive scheduler tunes per learner, not as science. What *is* science: one-shot courses with annual renewal fight the forgetting curve and lose; continuous scheduled retrieval wins.

**Law 4 — Frequent interaction, short video.** The best actual data point here is Guo et al.'s (2014) analysis of ~7M MOOC video-watching sessions: engagement drops sharply for videos beyond ~6 minutes, with shorter segments watched far more completely. The "interactive element every 2–3 minutes" figure quoted in microlearning articles is a design convention without a strong primary study behind it — but it's a sensible one, consistent with the testing-effect literature (interaction as retrieval). Treat both numbers as tunable defaults and let your own drop-off analytics (instrumented in §6) set the real thresholds.

**Law 5 — Active simulation beats passive click-through eLearning.** The peer-reviewed base: Cook et al.'s JAMA meta-analysis (~600 studies) found large effect sizes for technology-enhanced simulation on knowledge and skill outcomes versus lesser or no intervention, and self-paced eLearning's completion problem is well documented (median MOOC completion ~5–13% in the Jordan and Harvard/MIT edX analyses). *Caution:* headline vendor claims circulating in 2025–26 ("80–90% completion vs 15–20%", "70–80% retention at 30 days") trace only to AI-roleplay vendor marketing with no identifiable primary study — do not quote them to institutions or investors. The defensible claim is directional, and it's strong enough: simulation with feedback reliably outperforms passive content on skill transfer, and it is the single highest-leverage format decision for a product whose value proposition is counselling quality.

---

## 2. Session architecture: how a module becomes mobile-first

Take Course 1, Module 3 ("Assessing financial capacity", 14 min) and restructure it:

```
MICRO-UNIT PATTERN (repeat 3–5× per module)
┌─ HOOK (15–30 sec) ──────────────────────────────┐
│ Question-first: "Priya shows A$31,000 deposited │
│ 4 days before lodgement. Lodge or hold?"        │
│ Learner commits to an answer BEFORE any content │
│ (a "pretest" — priming wrong answers improves   │
│ subsequent encoding)                            │
├─ CONTENT (90–150 sec) ──────────────────────────┤
│ One concept only. Vertical video, narrated      │
│ card stack, or annotated document — never a     │
│ slide dump. Dual-coded: visual + narration.     │
├─ RETRIEVE (30–60 sec) ──────────────────────────┤
│ 1–3 questions. Scenario-framed, not definitional│
│ ("What do you ask Priya next?" not "What is the │
│ financial capacity benchmark?")                 │
├─ ANCHOR (10 sec) ───────────────────────────────┤
│ One-line takeaway card, saveable to the         │
│ counsellor's personal "crib deck"               │
└─────────────────────────────────────────────────┘
```

**Rules of thumb:**

- One concept per micro-unit. If a unit needs the word "also", split it.
- Every unit is a legitimate stopping point — commutes and between-appointment gaps are the real session lengths. Progress must never be lost mid-unit; state saves on every interaction.
- Thumb-reach interactions only: tap, swipe, drag. No typing during learning (typing is reserved for the roleplay format, below).
- Front-load the most misunderstood concept in each module (primacy effect) and end on the highest-stakes compliance point (recency effect).

---

## 3. The retention engine: credential decay as spaced retrieval

This is where CounselIQ's existing mechanic — credentials expire unless refreshed — becomes a genuine pedagogical asset rather than an admin chore. Replace the annual renewal cliff with **continuous adaptive refresh**, directly mirroring the frntlne Course → Refresher 1 → Refresher 2 model:

**The schedule (per concept, not per course):**

| Event | Timing | Format |
|---|---|---|
| Initial learning | Day 0 | Micro-unit sequence |
| Refresher 1 | +24–48 hrs | 3–5 retrieval questions, push-triggered |
| Refresher 2 | +7 days | Scenario variant of the same concepts |
| Refresher 3 | +21 days | Interleaved with other modules' concepts |
| Maintenance | Every 30–60 days, adaptive | 2-min "credential pulse" |

**Adaptive scheduling.** Don't use fixed intervals per learner — use a memory-model scheduler (FSRS-class or half-life regression) that predicts per-concept forgetting from each counsellor's answer history and schedules the next retrieval just before predicted forgetting. Concepts answered confidently stretch to long intervals; shaky ones return sooner. Research on AI-personalised review scheduling shows this materially outperforms fixed calendars, and the models are simple enough to run server-side against your existing Postgres event data.

**Credential health, not credential expiry.** Each badge carries a live "health" score (the average predicted retention across its concepts). Health decays visibly if pulses are skipped; it never cliff-drops. Agencies are ranked on *credential health density* — which makes the ranking a measure of current knowledge, not historical test-passing. This is both better pedagogy and a stickier engagement loop: two minutes a day maintains everything.

**Interleaving.** Maintenance pulses deliberately mix concepts across courses (a GS question, then a La Trobe intake question, then a financial evidence question). Interleaved retrieval is harder in the moment and produces stronger discrimination between similar concepts — exactly the skill counsellors need (e.g., visa-level vs. course-level English requirements).

---

## 4. Completion mechanics (getting them to finish)

1. **Streak on retrieval, not on content.** The daily habit unit is the 2-minute pulse, not a lesson. Completing any retrieval act maintains the streak. Streak-freezes are earnable so the mechanic motivates without punishing a day off.
2. **Progress by concepts mastered, not videos watched.** A mastery bar ("31/40 concepts secure") is honest and motivating; a video-completion bar invites background-play cheating.
3. **Session-end cliffhanger.** Each micro-unit ends by *showing* the next hook question, unanswered. Opening a loop is the cheapest continuation driver there is.
4. **Push notifications carry a retrieval question in the notification itself.** "Quick one: can a packaged ELICOS + Masters offer go on a single CoE?" — answerable from the lock screen on supported platforms. The notification *is* the learning event, not an ad for one.
5. **Scarcity that's real, not fake.** Government live sessions (Course 2) are genuinely scheduled events with attendance auto-recorded — surface seats/countdown honestly.
6. **Social proof inside agencies.** Weekly agency digest: team credential health, who's climbing. The agency-ranking feature already creates the incentive; expose it at individual level internally only (public shaming externally would backfire with agency owners).
7. **Time-to-value under 10 minutes.** A new counsellor should earn their first micro-badge ("GS Fundamentals — Bronze") in the first session. (Product heuristic, not a research finding — early activation as a retention driver is standard growth practice, but validate the badge→week-2-return correlation with your own cohort data.)

---

## 5. Innovative formats — ranked by leverage

### 5.1 AI student roleplay: "Counsel the student" (highest leverage)

The Mimic pattern, applied to counselling. Instead of answering questions *about* the GS requirement, the counsellor conducts a chat (or voice) consultation with an AI-simulated student persona — "Amara, 24, Nigerian, Master of Public Health aspirant, sponsor is an uncle, 6-month employment gap" — and must surface the red flags, ask the right discovery questions, and produce correct advice. The AI plays the student *and* grades the consultation against a rubric (issues surfaced, misinformation given, ethics breaches, GS-narrative quality).

Why this is the flagship format:

- It assesses the actual job (counselling), not proxy knowledge. A counsellor can pass MCQs and still steer students badly; they cannot fake a good consultation.
- The performance data it generates (issues missed, advice quality trends) is a far deeper moat dataset than quiz scores — it strengthens the "defensible data moat" slide materially.
- Simulation-based practice is where the strongest evidence for skill transfer sits (Cook et al., JAMA meta-analysis; simulation-based mastery learning literature); it's the engagement format, not just the assessment format — and CounselIQ's own pilot data can become the first credible completion/retention benchmark for this category.
- Personas are cheaply generated per market: the same engine produces Vietnamese, Indian, Colombian student profiles with market-authentic financial and documentation patterns — which becomes the localisation layer for UK/Canada expansion.

Gate Level 3 specialist badges on passing roleplay consultations, not MCQs. Keep MCQs for Level 1–2 knowledge gates.

### 5.2 Retrieval in the flow of work: the ARS becomes the teacher

When a counsellor opens an Application Readiness Score and a dimension is weak (say, Visa/GS intent at 61), attach a contextual 90-second micro-unit: "Why this score is low + the two questions to ask this student." Just-in-time learning at the moment of need is strongly favoured in the transfer-of-training literature and in workflow-learning practice, and it turns every real application into a training event. Track "learned at point of need" separately; it should correlate with subsequent ARS improvements, giving institutions an outcome metric no competitor can show.

### 5.3 Vertical feed for content delivery

Deliver the CONTENT phase as a swipeable vertical feed (60–90 sec clips, captions-on by default, narrated over institution slide crops — the AI slide-to-video pipeline in your appendix already produces this). The feed is *bounded per module* — a chapter of 5 clips, not infinite scroll. You want the consumption ergonomics of short video without training doom-scroll behaviour; the retrieval interstitials every 2–3 clips enforce that.

### 5.4 Branching document simulations

For fraud detection (Course 2 M2) and financial evidence (Course 1 M3): present actual document facsimiles — a bank statement, a transcript — and have the counsellor tap the anomalies. Time-boxed "spot the fabrication" rounds with a leaderboard. Perceptual skills (recognising a doctored statement) are learned by exposure to many examples with immediate feedback, not by rules — this format is the only honest way to teach it.

### 5.5 Voice mode for commute learning

Pulses and refreshers offered as audio Q&A ("Answer aloud after the tone… here's the model answer"). Counsellors in this industry are heavily mobile and multilingual; audio retrieval extends daily engagement windows dramatically and costs little given the TTS pipeline already exists for slide narration.

### 5.6 AI-generated "personal exam" before badge issuance

Rather than a static final test, the assessment engine assembles each counsellor's final from *their own weakest concepts* (from pulse history) plus a mandatory compliance core. Harder to game, fairer, and each exam is unique — which also neutralises answer-sharing between counsellors, an obvious integrity risk for a credential whose value depends on being un-fakeable.

---

## 6. What this means for the seven courses

| Course | Primary format | Assessment gate |
|---|---|---|
| 1. Counselling for Australia | Micro-units + document sims | Adaptive MCQ + 1 roleplay consult |
| 2. Home Affairs stream | Live sessions + fraud document sims | Spot-the-fabrication practical |
| 3. La Trobe Essentials | Vertical feed (slide-derived) | Adaptive MCQ |
| 4. Courses & Admissions | Micro-units + matching drills | Scenario MCQ (student-profile matching) |
| 5–7. Specialisations | Roleplay-first | AI student consultation, rubric-graded |
| Renewals | Daily pulses, adaptive scheduler | Continuous credential health |

**Metrics to instrument from day one:** micro-unit completion by position (find the drop-off unit), pulse response latency and accuracy (feeds the scheduler), 7/30-day retrieval accuracy (the retention claim for institutional sales), roleplay rubric scores over time, and ARS-dimension improvement following point-of-need learning (the outcome story for the Series A deck).

---

## 7. One strategic note

The pedagogy above *is* a pitch asset. "Credentials backed by continuous spaced retrieval and simulated-consultation assessment" is a categorically stronger claim than "counsellors passed a test once" — it's the difference between a certificate and a live guarantee of current competence, and it's what justifies institutions paying annually rather than once. The frntlne spaced-repetition engine and the Mimic roleplay engine are, structurally, most of this build.
