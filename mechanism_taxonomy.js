/*
  mechanism_taxonomy.js
  ---------------------------------------------------------------
  Punarvasu Clinic — "Generate Case Narrative" feature
  LAYER 0: Shared pathophysiological mechanism taxonomy

  Purpose:
  Both rubrics (symptoms) and remedies need to be described in a
  common vocabulary before they can be meaningfully connected to
  each other. This file defines that vocabulary — a fixed list of
  physiological process categories — and provides two deterministic,
  keyword-based classifiers:

    classifyMechanisms(text)            -> tags free text (a rubric's
                                            path, or a remedy's
                                            pathophysiology sentence)
                                            against the taxonomy
    classifyComorbidityMechanisms(text) -> tags a patient history
                                            string against the same
                                            taxonomy, using a separate
                                            comorbidity-specific map

  Nothing here is AI-generated at runtime — every tag is a keyword
  match against hand-written patterns. That means every tag is
  auditable (you can see exactly which word triggered it) but also
  means these patterns are a first pass: they have not been run
  against your real case data yet. Expect to tune MECHANISM_PATTERNS
  the same way QUALIFIER_PATTERNS in case_narrative_data_assembly.js
  needed tuning — this is the next thing to calibrate once you test
  against real cases.
*/

(function (global) {
  'use strict';

  // ---------------------------------------------------------------
  // The taxonomy itself — 18 categories. Every mechanism tag used
  // anywhere in the system (rubrics, remedies, comorbidities) must
  // be one of these strings.
  // ---------------------------------------------------------------

  const MECHANISMS = [
    'Vascular/Circulatory',
    'Autonomic/Nervous Regulation',
    'Metabolic/Glycemic',
    'Inflammatory/Immune',
    'Structural/Degenerative',
    'Secretory/Glandular',
    'Hemorrhagic/Coagulation',
    'Neuromuscular',
    'Thermoregulatory',
    'Psychoemotional/Stress-axis',
    'Digestive-Motility',
    'Secretory-Mucosal',
    'Suppurative/Infective',
    'Nutritive/Deficiency',
    'Reproductive-Hormonal',
    'Renal/Urinary-Excretory',
    'Respiratory-Ventilatory',
    'Connective Tissue/Rheumatic'
  ];

  // ---------------------------------------------------------------
  // Keyword patterns for classifying free text (rubric paths,
  // remedy pathophysiology sentences) against the taxonomy above.
  // A single piece of text can match multiple mechanisms — that's
  // expected and often clinically meaningful (e.g. "burning, worse
  // heat" can be both Vascular and Thermoregulatory).
  // ---------------------------------------------------------------

  const MECHANISM_PATTERNS = {
    'Vascular/Circulatory': /\b(congestion|congestive|flush(ing|es)?|blood vessels?|circulat\w*|vascular|varicos\w*|blueness|cyanotic|dropsical|edema\w*|swelling|pulsat\w*|throb\w*|hyperemia|capillar\w*)\b/i,
    'Autonomic/Nervous Regulation': /\b(nervous\w*|palpitation\w*|anxiet\w*|trembl\w*|tremor\w*|restless\w*|sensitiv\w*|reflex\w*|autonomic|excitab\w*)\b/i,
    'Metabolic/Glycemic': /\b(hunger|weakness.*eating|thirst\w*|emaciat\w*|obesity|metaboli\w*|sugar|glycemic|wasting)\b/i,
    'Inflammatory/Immune': /\b(inflamm\w*|swelling|redness|hot|fever\w*|erysipel\w*|acute)\b/i,
    'Structural/Degenerative': /\b(degenerat\w*|chronic|hardening|indurat\w*|scirrhus|fibroid\w*|deform\w*|stiffness|contracture\w*|scar\w*|atroph\w*)\b/i,
    'Secretory/Glandular': /\b(gland\w*|secretion\w*|discharge\w*|perspiration|sweat\w*|saliva\w*|milk|lactation)\b/i,
    'Hemorrhagic/Coagulation': /\b(hemorrhag\w*|bleeding|blood(?!\s+vessels)|clot\w*|hematuria|epistaxis|menorrhagia|metrorrhagia)\b/i,
    'Neuromuscular': /\b(weakness|paraly\w*|numbness|spasm\w*|cramp\w*|twitch\w*|convuls\w*|trembling|jerking|stiffness|paretic)\b/i,
    'Thermoregulatory': /\b(chill\w*|chilly|coldness|heat|warmth|fever\w*|perspiration|thermoregulat\w*)\b/i,
    'Psychoemotional/Stress-axis': /\b(anxiet\w*|fear\w*|grief|anger|irritab\w*|mind|mental|emotion\w*|mood|weeping|sadness|excitement)\b/i,
    'Digestive-Motility': /\b(constipation|diarrhea|flatulen\w*|colic\w*|peristal\w*|stool|bowel\w*|motility|bloating|distension)\b/i,
    'Secretory-Mucosal': /\b(catarrh\w*|mucus|discharge\w*|coryza|nasal|phlegm\w*|expectorat\w*)\b/i,
    'Suppurative/Infective': /\b(suppurat\w*|pus|abscess\w*|infect\w*|septic|purulent|ulcer\w*)\b/i,
    'Nutritive/Deficiency': /\b(emaciat\w*|malnutrition|wasting|deficien\w*|nutrit\w*|anemia)\b/i,
    'Reproductive-Hormonal': /\b(menses|menstrual|ovar\w*|uterus|uterine|testes|prostat\w*|sexual|hormon\w*|climacteric|menopause)\b/i,
    'Renal/Urinary-Excretory': /\b(urin\w*|kidney\w*|renal|bladder|urethra\w*|nephrit\w*)\b/i,
    'Respiratory-Ventilatory': /\b(breath\w*|dyspnea|asthma|cough\w*|respirat\w*|wheeze\w*|suffocat\w*|chest)\b/i,
    'Connective Tissue/Rheumatic': /\b(rheumatic|rheumatism|joint\w*|arthrit\w*|gouty|periosteum|tendon\w*|ligament\w*|synovi\w*)\b/i
  };

  // ---------------------------------------------------------------
  // Comorbidity -> mechanism reinforcement map. Deliberately small
  // and conservative: only maps well-established physiological
  // associations (e.g. diabetes predisposes to vascular and
  // neuromuscular pathology), stated as background predisposition,
  // not causation for any specific patient.
  // ---------------------------------------------------------------

  const COMORBIDITY_MECHANISM_MAP = {
    diabetes: ['Metabolic/Glycemic', 'Vascular/Circulatory', 'Neuromuscular', 'Renal/Urinary-Excretory'],
    diabetic: ['Metabolic/Glycemic', 'Vascular/Circulatory', 'Neuromuscular', 'Renal/Urinary-Excretory'],
    dieabetes: ['Metabolic/Glycemic', 'Vascular/Circulatory', 'Neuromuscular', 'Renal/Urinary-Excretory'],
    sugar: ['Metabolic/Glycemic'],
    'blood pressure': ['Vascular/Circulatory'],
    'high blood pressure': ['Vascular/Circulatory'],
    'high bp': ['Vascular/Circulatory'],
    bp: ['Vascular/Circulatory'],
    hypertension: ['Vascular/Circulatory'],
    'high cholesterol': ['Vascular/Circulatory', 'Metabolic/Glycemic'],
    cholesterol: ['Vascular/Circulatory', 'Metabolic/Glycemic'],
    choesterol: ['Vascular/Circulatory', 'Metabolic/Glycemic'],
    thyroid: ['Metabolic/Glycemic', 'Thermoregulatory'],
    hypothyroid: ['Metabolic/Glycemic', 'Thermoregulatory', 'Nutritive/Deficiency'],
    hyperthyroid: ['Metabolic/Glycemic', 'Thermoregulatory', 'Autonomic/Nervous Regulation'],
    asthma: ['Respiratory-Ventilatory'],
    arthritis: ['Connective Tissue/Rheumatic', 'Structural/Degenerative'],
    gout: ['Connective Tissue/Rheumatic', 'Metabolic/Glycemic'],
    anemia: ['Nutritive/Deficiency', 'Vascular/Circulatory'],
    obesity: ['Metabolic/Glycemic', 'Vascular/Circulatory'],
    overweight: ['Metabolic/Glycemic', 'Vascular/Circulatory'],
    'kidney disease': ['Renal/Urinary-Excretory'],
    kidney: ['Renal/Urinary-Excretory'],
    'heart disease': ['Vascular/Circulatory'],
    heart: ['Vascular/Circulatory'],
    cardiac: ['Vascular/Circulatory'],
    menopause: ['Reproductive-Hormonal', 'Thermoregulatory'],
    depression: ['Psychoemotional/Stress-axis'],
    anxiety: ['Psychoemotional/Stress-axis', 'Autonomic/Nervous Regulation'],
    stress: ['Psychoemotional/Stress-axis', 'Autonomic/Nervous Regulation']
  };

  // ---------------------------------------------------------------
  // Classifiers
  // ---------------------------------------------------------------

  function classifyMechanisms(text) {
    if (!text) return [];
    const tags = [];
    for (const mech of MECHANISMS) {
      const pattern = MECHANISM_PATTERNS[mech];
      if (pattern && pattern.test(text)) tags.push(mech);
    }
    return tags;
  }

  function classifyComorbidityMechanisms(historyText) {
    if (!historyText) return [];
    const lower = historyText.toLowerCase();
    const tagSet = new Set();
    for (const [term, mechs] of Object.entries(COMORBIDITY_MECHANISM_MAP)) {
      if (lower.includes(term)) mechs.forEach(m => tagSet.add(m));
    }
    return Array.from(tagSet);
  }

  // ---------------------------------------------------------------
  // Fallback: broad anatomical "system" labels (Nervous, Digestive,
  // etc. — used elsewhere in this codebase for chapter matching)
  // don't always contain a mechanism keyword in their own text.
  // This gives every system a sensible default mechanism so no
  // affinity is left completely untagged.
  // ---------------------------------------------------------------

  const SYSTEM_DEFAULT_MECHANISM = {
    Nervous: 'Autonomic/Nervous Regulation',
    Cardiovascular: 'Vascular/Circulatory',
    Digestive: 'Digestive-Motility',
    Respiratory: 'Respiratory-Ventilatory',
    Musculoskeletal: 'Neuromuscular',
    Integumentary: 'Secretory/Glandular',
    Reproductive: 'Reproductive-Hormonal',
    Urinary: 'Renal/Urinary-Excretory',
    Sensory: 'Autonomic/Nervous Regulation',
    Constitutional: 'Thermoregulatory'
  };

  global.SYSTEM_DEFAULT_MECHANISM = SYSTEM_DEFAULT_MECHANISM;


  global.MECHANISMS = MECHANISMS;
  global.MECHANISM_PATTERNS = MECHANISM_PATTERNS;
  global.COMORBIDITY_MECHANISM_MAP = COMORBIDITY_MECHANISM_MAP;
  global.classifyMechanisms = classifyMechanisms;
  global.classifyComorbidityMechanisms = classifyComorbidityMechanisms;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MECHANISMS, MECHANISM_PATTERNS, COMORBIDITY_MECHANISM_MAP, SYSTEM_DEFAULT_MECHANISM, classifyMechanisms, classifyComorbidityMechanisms };
  }

})(typeof window !== 'undefined' ? window : globalThis);
