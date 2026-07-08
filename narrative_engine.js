/*
  narrative_engine.js
  ---------------------------------------------------------------
  Punarvasu Clinic — "Generate Case Narrative" feature
  LAYER 2 (revised): Template-based generation, NO API calls.

  Input:  the JSON produced by assembleCaseNarrativeData() in
          case_narrative_data_assembly.js
  Input:  remedy_pathophysiology_db.json (static, hand-curated)
  Output: a structured, editable draft narrative — plain text,
          ready to drop into the patient's case file after your
          review. Nothing here is sent to the patient automatically.

  Everything below is deterministic: lookups, keyword matching,
  and template assembly. If a remedy has no entry in the DB, the
  engine says so explicitly rather than inventing content.
*/

(function (global) {
  'use strict';

  // ---------------------------------------------------------------
  // Chapter -> broad system mapping. Tune this list as you add
  // chapters; it only needs to cover chapters that actually show
  // up in cases, not the full 40+ up front.
  // ---------------------------------------------------------------

  const CHAPTER_TO_SYSTEM = {
    Mind: 'Nervous',
    Vertigo: 'Nervous',
    Head: 'Nervous',
    Eye: 'Sensory',
    Vision: 'Sensory',
    Ear: 'Sensory',
    Hearing: 'Sensory',
    Nose: 'Respiratory',
    Face: 'Integumentary',
    Mouth: 'Digestive',
    Teeth: 'Digestive',
    Throat: 'Respiratory',
    Stomach: 'Digestive',
    Abdomen: 'Digestive',
    Rectum: 'Digestive',
    Stool: 'Digestive',
    Urinary: 'Urinary',
    Bladder: 'Urinary',
    Kidneys: 'Urinary',
    Male: 'Reproductive',
    'Genitalia, Male': 'Reproductive',
    Female: 'Reproductive',
    'Genitalia, Female': 'Reproductive',
    Larynx: 'Respiratory',
    Respiration: 'Respiratory',
    Cough: 'Respiratory',
    Expectoration: 'Respiratory',
    Chest: 'Respiratory',
    Heart: 'Cardiovascular',
    Back: 'Musculoskeletal',
    Extremities: 'Musculoskeletal',
    Sleep: 'Nervous',
    Dreams: 'Nervous',
    Chill: 'Constitutional',
    Fever: 'Constitutional',
    Perspiration: 'Constitutional',
    Skin: 'Integumentary',
    Generalities: 'Constitutional'
  };

  function systemForChapter(chapter) {
    return CHAPTER_TO_SYSTEM[chapter] || null;
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  function keywordOverlap(qualifierText, phraseList) {
    if (!qualifierText || !phraseList) return [];
    const text = qualifierText.toLowerCase();
    const hits = [];
    for (const phrase of phraseList) {
      // take the phrase apart into individual keywords after "worse:"/"better:"/etc
      const words = phrase
        .replace(/^(worse|better|ailments from):?\s*/i, '')
        .split(/,|\/| and /i)
        .map(w => w.trim().toLowerCase())
        .filter(Boolean);
      for (const w of words) {
        if (w.length > 2 && text.includes(w)) {
          hits.push({ phrase, matchedOn: w });
          break;
        }
      }
    }
    return hits;
  }

  function describeRubricEvidence(rubric, remedyAbbr) {
    const match = rubric.prescribedRemedyMatches.find(m => m.remedy === remedyAbbr);
    if (!match) return null;
    const gradeLabel = { 1: 'Grade I', 2: 'Grade II', 3: 'Grade III' }[match.grade] || 'ungraded';
    const soleFlag = match.isSoleRemedy ? ', sole remedy in this rubric' : '';
    const rarityFlag = rubric.rarity === 'rare' ? ', rare rubric' : '';
    return `"${rubric.mainRubric}"${rubric.qualifierText ? ' (' + rubric.qualifierText + ')' : ''} [${gradeLabel}${soleFlag}${rarityFlag}]`;
  }

  // ---------------------------------------------------------------
  // Case-level synthesized pathophysiology
  // ---------------------------------------------------------------

  function buildMechanismSynthesisSection(assembledData) {
    const profile = assembledData.mechanismProfile;
    if (!profile || !profile.ranked || !profile.ranked.length) return null;
    const top = profile.ranked.filter(m => m.weight > 0).slice(0, 6);
    if (!top.length) return null;

    const lines = top.map(m => {
      const rubricsText = m.supportingRubrics.length
        ? `driven by the rubric(s): ${m.supportingRubrics.join(', ')}`
        : 'present only via patient history, with no directly selected rubric tagged to this mechanism';
      const historyNote = m.reinforcedByHistory
        ? ' This is also consistent with the patient\'s documented history, which independently predisposes toward this mechanism.'
        : '';
      return `${m.mechanism} (weight ${m.weight}) — ${rubricsText}.${historyNote}`;
    });

    lines.push(
      'This mechanism ranking is a deterministic tally, not a diagnosis: each selected rubric was tagged against ' +
      'a fixed pathophysiological taxonomy by keyword matching, weighted by how rare/characteristic the rubric is, ' +
      'and combined with any comorbidities mentioned in patient history. Treat it as a synthesized hypothesis about ' +
      'the case\'s underlying pattern for your own clinical judgment to confirm or override.'
    );

    return lines.join(' ');
  }

  // ---------------------------------------------------------------
  // Per-remedy section
  // ---------------------------------------------------------------

  function buildRemedySection(remedyAbbr, assembledData, remedyDB) {
    const content = remedyDB.remedies[remedyAbbr];
    const relevantRubrics = assembledData.rubrics.filter(
      r => r.found && r.prescribedRemedyMatches.some(m => m.remedy === remedyAbbr)
    );
    const rankedMechanisms = (assembledData.mechanismProfile && assembledData.mechanismProfile.ranked) || [];
    const topMechanisms = rankedMechanisms.filter(m => m.weight > 0);
    const topMechanismNames = new Set(topMechanisms.map(m => m.mechanism));

    if (!content) {
      return {
        remedy: remedyAbbr,
        available: false,
        text: `${remedyAbbr}: pathophysiology content has not been curated yet for this remedy. ` +
              `Supporting rubrics from this case: ` +
              relevantRubrics.map(r => describeRubricEvidence(r, remedyAbbr)).join('; ') + '.'
      };
    }

    const lines = [];
    lines.push(`${content.fullName} (${remedyAbbr}) — ${content.actionType} action. ${content.actionTypeNote}`);

    // Match remedy's system affinities against the CASE'S SYNTHESIZED MECHANISMS
    // (not raw chapter overlap) — this is the connective-tissue step: does this
    // remedy's own documented pathophysiology address the mechanism pattern the
    // case's rubrics collectively point to, rather than just sharing a chapter label.
    const affinityMatches = [];
    for (const aff of content.systemAffinities) {
      const mechs = aff.mechanisms || [];
      const overlap = mechs.filter(m => topMechanismNames.has(m));
      if (overlap.length) affinityMatches.push({ aff, overlap });
    }

    if (affinityMatches.length) {
      for (const { aff, overlap } of affinityMatches) {
        const evidenceRubricsSet = new Set();
        const mechanismDescriptions = overlap.map(mech => {
          const entry = topMechanisms.find(t => t.mechanism === mech);
          if (entry) entry.supportingRubrics.forEach(r => evidenceRubricsSet.add(r));
          const historyTag = entry && entry.reinforcedByHistory ? ', reinforced by patient history' : '';
          return `${mech} (weight ${entry ? entry.weight : '?'}${historyTag})`;
        }).join('; ');

        const directEvidence = relevantRubrics
          .filter(r => systemForChapter(r.chapter) === aff.system)
          .map(r => describeRubricEvidence(r, remedyAbbr))
          .filter(Boolean)
          .join('; ');

        lines.push(
          `${aff.system} affinity (rank ${aff.prominence} for this remedy) matches the case's synthesized ${mechanismDescriptions} ` +
          `pattern — driven in this case by: ${Array.from(evidenceRubricsSet).join(', ') || 'patient history'}. ${aff.pathophysiology}` +
          (directEvidence ? ` Directly supported by the prescribed rubric(s): ${directEvidence}.` : '')
        );
      }
    } else {
      const remedyMechanisms = [...new Set(content.systemAffinities.flatMap(a => a.mechanisms || []))];
      lines.push(
        `Note: none of this remedy's documented mechanisms (${remedyMechanisms.join(', ') || 'none tagged'}) overlap with ` +
        `this case's synthesized pathophysiological pattern (${topMechanisms.map(m => m.mechanism).join(', ') || 'no dominant mechanism identified'}). ` +
        `Review whether the prescription rests on generals/constitutional grounds rather than the mechanism pattern captured here.`
      );
    }

    // Modality / causation corroboration
    const allQualifierText = relevantRubrics.map(r => r.qualifierText).join('; ');
    const modalityHits = keywordOverlap(allQualifierText, content.characteristicModalities);
    const causationHits = keywordOverlap(allQualifierText, content.characteristicCausations);

    if (modalityHits.length) {
      lines.push(
        `Modality corroboration: the case's rubric qualifiers include "${modalityHits.map(h => h.matchedOn).join('", "')}", ` +
        `matching this remedy's known characteristic modality pattern (${content.characteristicModalities.join('; ')}).`
      );
    }
    if (causationHits.length) {
      lines.push(
        `Causation corroboration: matches this remedy's known causation pattern (${content.characteristicCausations.join('; ')}).`
      );
    }

    // Rarity / sole-remedy emphasis
    const soleOrRare = relevantRubrics.filter(r => {
      const m = r.prescribedRemedyMatches.find(mm => mm.remedy === remedyAbbr);
      return r.rarity === 'rare' || (m && m.isSoleRemedy);
    });
    if (soleOrRare.length) {
      lines.push(
        `Prescribing weight: ${soleOrRare.length} of the supporting rubric(s) are rare and/or ones where this is the sole ` +
        `or near-sole covering remedy — per the classical principle that peculiar, characteristic symptoms carry more ` +
        `weight than common ones in individualized prescribing.`
      );
    }

    if (content.constitutionalNote) {
      lines.push(`Constitutional note: ${content.constitutionalNote}`);
    }

    return { remedy: remedyAbbr, available: true, text: lines.join(' ') };
  }

  // ---------------------------------------------------------------
  // Case-level affinity section
  // ---------------------------------------------------------------

  function buildAffinitySection(assembledData) {
    if (!assembledData.affinityLinks || !assembledData.affinityLinks.length) return null;
    const lines = assembledData.affinityLinks.map(l =>
      `"${l.symptomA}" and "${l.symptomB}" (${l.chapter}) show a known remedy-level correlation ` +
      `(Jaccard ${l.jaccard.toFixed(3)}, ${l.sharedRemedyCount} shared Grade III remedies) — their co-occurrence in ` +
      `this case reinforces rather than duplicates the totality.`
    );
    return lines.join(' ');
  }

  // =================================================================
  // PATIENT-FRIENDLY NARRATIVE MODE
  // ---------------------------------------------------------------
  // Same underlying data (assembledData + remedyDB), different
  // output register: plain language, step-by-step, no jargon like
  // "affinity rank" or "mechanism weight." Still deterministic —
  // template assembly, not free generation. Intended as a draft for
  // the doctor to review/edit before reading to or sharing with the
  // patient; not sent to the patient automatically.
  // =================================================================

  const PATIENT_MECHANISM_EXPLANATIONS = {
    'Vascular/Circulatory': 'Your blood flow and circulation in the affected area seem to be part of what is driving this — blood vessels can become congested, swollen, or under-supplied, which produces many of the sensations you are describing.',
    'Autonomic/Nervous Regulation': 'Your nervous system\'s automatic control over your body — things like heart rate, digestion, and internal sensation — appears to be overreacting or out of balance right now, which can produce real physical symptoms even without anything being structurally damaged.',
    'Metabolic/Glycemic': 'Your body\'s energy and blood sugar regulation seem to be part of the picture — when this balance is disturbed, it can affect how your whole body feels and functions.',
    'Inflammatory/Immune': 'There appears to be an active inflammatory response — your body\'s natural defense and repair system reacting to something, producing heat, swelling, or irritation.',
    'Structural/Degenerative': 'This looks like a longer-standing, slowly developing change in the tissues themselves, rather than a sudden problem — the kind that builds up gradually over time.',
    'Secretory/Glandular': 'Your body\'s glands and normal secretions — sweat, saliva, discharge — seem to be behaving differently than they should, which is contributing to what you are feeling.',
    'Hemorrhagic/Coagulation': 'There is a tendency toward bleeding or blood-clotting irregularity playing a role here.',
    'Neuromuscular': 'Your nerves and muscles appear to be losing some of their normal coordination — this can show up as weakness, cramping, trembling, or numbness.',
    'Thermoregulatory': 'Your body\'s internal temperature control seems to be part of what is off balance — how you handle heat, cold, and fevers.',
    'Psychoemotional/Stress-axis': 'Your emotional state and physical symptoms appear closely linked. Ongoing stress, anxiety, or emotional strain does not just stay in the mind — it can genuinely produce physical sensations in the body, and that seems to be a real part of what you are experiencing.',
    'Digestive-Motility': 'Your digestive system\'s normal movement — the way food and waste travel through your gut — appears to be disrupted.',
    'Secretory-Mucosal': 'The mucous membranes, such as in your nose or throat, seem to be overproducing or reacting abnormally, leading to discharge or congestion.',
    'Suppurative/Infective': 'There is a tendency toward infection or pus formation playing a role.',
    'Nutritive/Deficiency': 'Your body\'s ability to absorb or use nutrients properly may be part of the picture, affecting your overall strength and energy.',
    'Reproductive-Hormonal': 'Your reproductive and hormonal system appears to be part of what is driving this.',
    'Renal/Urinary-Excretory': 'Your kidneys and urinary system\'s normal function appear to be involved in this pattern.',
    'Respiratory-Ventilatory': 'Your breathing and the way your lungs move air appear to be part of this pattern.',
    'Connective Tissue/Rheumatic': 'Your joints and connective tissue seem to be involved — the kind of pattern seen in rheumatic-type complaints.'
  };

  const ACTION_TYPE_PATIENT_NOTE = {
    'functional': 'This is generally understood as a reversible disturbance in how your body is working, rather than permanent damage — your system has good potential to return to normal balance with the right treatment.',
    'structural': 'This reflects a deeper, more established change in the tissue itself, so treatment aims to support your body\'s own repair and regulatory capacity over a longer course.',
    'functional-to-structural': 'This kind of condition can range from a reversible disturbance to something more established in the tissue — treatment aims to address it while your body still has good capacity to recover.'
  };

  function buildPatientSymptomList(assembledData) {
    const found = assembledData.rubrics.filter(r => r.found);
    if (!found.length) return null;
    const lines = found.map(r => {
      const desc = r.qualifierText ? `${r.mainRubric}, ${r.qualifierText}` : r.mainRubric;
      return `In the ${r.chapter.toLowerCase()}: a symptom described as "${desc}".`;
    });
    return lines.join(' ');
  }

  function buildPatientMechanismExplanation(assembledData) {
    const profile = assembledData.mechanismProfile;
    if (!profile || !profile.ranked || !profile.ranked.length) return null;
    const top = profile.ranked.filter(m => m.weight > 0).slice(0, 4);
    if (!top.length) return null;

    const lines = top.map(m => {
      const explanation = PATIENT_MECHANISM_EXPLANATIONS[m.mechanism] || `A disturbance related to ${m.mechanism.toLowerCase()} appears to be part of the picture.`;
      const historyNote = m.reinforcedByHistory
        ? ' This also fits with your existing health history, which can make your body more prone to this kind of pattern.'
        : '';
      return `${explanation}${historyNote}`;
    });
    return lines.join(' ');
  }

  function buildPatientRemedyExplanation(remedyAbbr, assembledData, remedyDB) {
    const content = remedyDB.remedies[remedyAbbr];
    if (!content) {
      return `${remedyAbbr}: a detailed plain-language explanation is not yet available for this remedy in our system — your doctor will explain this one directly.`;
    }

    // What this medicine is classically/best known for overall — its single
    // most prominent documented affinity, plus its constitutional picture —
    // independent of whether it happens to match this particular case.
    const topAffinity = content.systemAffinities.slice().sort((a, b) => a.prominence - b.prominence)[0];
    const bestKnownFor = topAffinity ? topAffinity.pathophysiology : '';
    const actionNote = ACTION_TYPE_PATIENT_NOTE[content.actionType] || '';

    // Whether this case's synthesized mechanisms give an additional, more
    // specific reason this medicine was chosen for this patient.
    const rankedMechanisms = (assembledData.mechanismProfile && assembledData.mechanismProfile.ranked) || [];
    const topMechanisms = rankedMechanisms.filter(m => m.weight > 0);
    const matchedAffinity = topMechanisms
      .map(m => content.systemAffinities.find(aff => (aff.mechanisms || []).includes(m.mechanism)))
      .find(Boolean);

    let text = `${content.fullName} is a medicine best known in classical homeopathic practice for: ${bestKnownFor} ${content.constitutionalNote || ''}`.trim();

    if (matchedAffinity && matchedAffinity !== topAffinity) {
      text += ` In your particular case, it is also considered relevant because: ${matchedAffinity.pathophysiology}`;
    }
    text += ` ${actionNote}`;

    return text.trim();
  }

  function generatePatientFriendlyNarrative(assembledData, remedyDB) {
    const prescribedRemedies = assembledData.remedySummary.map(r => r.remedy);

    const symptomText = buildPatientSymptomList(assembledData);
    const mechanismText = buildPatientMechanismExplanation(assembledData);
    const remedyTexts = prescribedRemedies.map(abbr => buildPatientRemedyExplanation(abbr, assembledData, remedyDB));

    const openingText = 'Based on what you have described, here is a simple explanation of what may be going on and how your treatment is intended to help.';

    const closingText =
      'This explanation is a starting point prepared for your doctor to review and discuss with you — it is not a final diagnosis, and your doctor may adjust it based on things not captured here.';

    const sections = [
      { title: 'What You Told Us', text: symptomText },
      { title: 'What May Be Happening In Your Body', text: mechanismText },
      { title: 'What Each Medicine Is Known For, And How It May Help You', text: remedyTexts.join('\n\n') },
      { title: 'A Note', text: closingText }
    ].filter(s => s.text);

    const plainText = openingText + '\n\n' + sections.map(s => `${s.title}\n${s.text}`).join('\n\n');

    return { generatedAt: new Date().toISOString(), sections, plainText };
  }


  function generateEvidenceBasedNarrative(assembledData, remedyDB, options) {
    const opts = options || {};
    const prescribedRemedies = assembledData.remedySummary.map(r => r.remedy);

    const remedySections = prescribedRemedies.map(abbr =>
      buildRemedySection(abbr, assembledData, remedyDB)
    );
    const affinityText = buildAffinitySection(assembledData);
    const mechanismSynthesisText = buildMechanismSynthesisSection(assembledData);

    const chaptersInvolved = [...new Set(assembledData.rubrics.filter(r => r.found).map(r => r.chapter))];
    const overviewText =
      `Case reviewed on ${assembledData.rubrics.length} selected rubric(s) across ${chaptersInvolved.length} ` +
      `chapter(s) (${chaptersInvolved.join(', ')}).`;

    const historyText = (assembledData.patientHistory && Object.keys(assembledData.patientHistory).length)
      ? `Relevant patient history on file: ${JSON.stringify(assembledData.patientHistory)}. ` +
        `This has not been cross-referenced against the remedy content automatically — review for interaction ` +
        `or contraindication relevance manually.`
      : null;

    const disclaimer =
      `This is an auto-generated draft assembled deterministically from repertorization data and a curated ` +
      `remedy content library — no AI model was used to generate this text. It is a starting point for ` +
      `your clinical write-up, not a finished case note, and is not visible to the patient until you approve it.`;

    const sections = [
      { title: 'Case Overview', text: overviewText },
      mechanismSynthesisText ? { title: 'Synthesized Pathophysiology', text: mechanismSynthesisText } : null,
      ...remedySections.map(s => ({ title: `Remedy: ${s.remedy}`, text: s.text, available: s.available })),
      affinityText ? { title: 'Cross-Rubric Correlation', text: affinityText } : null,
      historyText ? { title: 'Patient History', text: historyText } : null,
      { title: 'Note', text: disclaimer }
    ].filter(Boolean);

    return {
      generatedAt: new Date().toISOString(),
      sections,
      plainText: renderNarrativeText(sections)
    };
  }

  function renderNarrativeText(sections) {
    return sections.map(s => `${s.title}\n${s.text}`).join('\n\n');
  }

  global.generateEvidenceBasedNarrative = generateEvidenceBasedNarrative;
  global.generatePatientFriendlyNarrative = generatePatientFriendlyNarrative;
  global.renderNarrativeText = renderNarrativeText;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateEvidenceBasedNarrative, generatePatientFriendlyNarrative, renderNarrativeText, CHAPTER_TO_SYSTEM };
  }

})(typeof window !== 'undefined' ? window : globalThis);
