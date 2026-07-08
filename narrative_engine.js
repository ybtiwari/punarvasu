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
    'Vascular/Circulatory': 'blood flow and circulation seem to be part of what is driving this — blood vessels can become congested, swollen, or under-supplied',
    'Autonomic/Nervous Regulation': 'the nervous system\'s automatic control over the body — things like heart rate, digestion, and internal sensation — appears to be overreacting or out of balance',
    'Metabolic/Glycemic': 'the body\'s energy and blood sugar regulation seem to be part of the picture',
    'Inflammatory/Immune': 'there appears to be an active inflammatory response — the body\'s natural defense and repair system reacting to something',
    'Structural/Degenerative': 'this looks like a longer-standing, slowly developing change in the tissues themselves, rather than a sudden problem',
    'Secretory/Glandular': 'the glands and normal secretions — sweat, saliva, discharge — seem to be behaving differently than they should',
    'Hemorrhagic/Coagulation': 'there is a tendency toward bleeding or blood-clotting irregularity playing a role',
    'Neuromuscular': 'the nerves and muscles appear to be losing some of their normal coordination',
    'Thermoregulatory': 'the body\'s internal temperature control seems to be part of what is off balance',
    'Psychoemotional/Stress-axis': 'the emotional state and physical symptoms appear closely linked — ongoing stress or emotional strain does not just stay in the mind, it can genuinely produce physical sensations in the body',
    'Digestive-Motility': 'the digestive system\'s normal movement — the way food and waste travel through the gut — appears to be disrupted',
    'Secretory-Mucosal': 'the mucous membranes seem to be overproducing or reacting abnormally, leading to discharge or congestion',
    'Suppurative/Infective': 'there is a tendency toward infection or pus formation playing a role',
    'Nutritive/Deficiency': 'the body\'s ability to absorb or use nutrients properly may be part of the picture',
    'Reproductive-Hormonal': 'the reproductive and hormonal system appears to be part of what is driving this',
    'Renal/Urinary-Excretory': 'the kidneys and urinary system\'s normal function appear to be involved',
    'Respiratory-Ventilatory': 'the breathing and the way the lungs move air appear to be part of this pattern',
    'Connective Tissue/Rheumatic': 'the joints and connective tissue seem to be involved — the kind of pattern seen in rheumatic-type complaints'
  };

  const ACTION_TYPE_PATIENT_NOTE = {
    'functional': 'This is generally understood as a reversible disturbance rather than permanent damage — good potential to return to normal balance with the right treatment.',
    'structural': 'This reflects a deeper, more established change in the tissue itself, so treatment aims to support the body\'s own repair capacity over a longer course.',
    'functional-to-structural': 'This can range from a reversible disturbance to something more established in the tissue — treatment aims to address it while there is still good capacity to recover.'
  };

  // Plain-English substitutions for common rubric/medical terminology.
  // Not exhaustive — falls back to the original term if unmapped, so
  // unfamiliar or rare rubric words still display rather than vanish.
  const PLAIN_TERM_MAP = {
    coryza: 'a cold (runny or blocked nose)',
    eruptions: 'skin eruptions',
    herpes: 'a viral skin eruption',
    zoster: 'shingles',
    zona: 'shingles',
    vertigo: 'dizziness',
    dyspnea: 'difficulty breathing',
    dysuria: 'painful urination',
    tenesmus: 'straining without result',
    pruritus: 'itching',
    epistaxis: 'nosebleed',
    menorrhagia: 'heavy menstrual bleeding',
    leucorrhea: 'vaginal discharge',
    singultus: 'hiccups',
    cephalalgia: 'headache',
    flatulence: 'gas and bloating',
    palpitation: 'a fluttering or pounding heartbeat',
    convulsions: 'convulsions or seizures',
    insomnia: 'difficulty sleeping',
    somnolence: 'excessive sleepiness',
    anorexia: 'loss of appetite',
    bulimia: 'excessive hunger',
    coldness: 'a feeling of coldness',
    'agg': 'worse',
    'amel': 'better'
  };

  const CHAPTER_TO_ORGAN_PLAIN = {
    Mind: 'your mind and emotional state',
    Vertigo: 'your sense of balance',
    Head: 'your head',
    Eye: 'your eyes',
    Vision: 'your eyes',
    Ear: 'your ears',
    Hearing: 'your ears',
    Nose: 'your nose and sinuses',
    Face: 'your face',
    Mouth: 'your mouth',
    Teeth: 'your teeth',
    Throat: 'your throat',
    Stomach: 'your stomach',
    Abdomen: 'your abdominal organs (stomach and intestines)',
    Rectum: 'your rectum and bowel',
    Stool: 'your bowel movements',
    Urinary: 'your urinary system (bladder and kidneys)',
    Bladder: 'your bladder',
    Kidneys: 'your kidneys',
    Male: 'your reproductive organs',
    'Genitalia, Male': 'your reproductive organs',
    Female: 'your reproductive organs',
    'Genitalia, Female': 'your reproductive organs',
    Larynx: 'your throat and voice box',
    Respiration: 'your lungs and breathing',
    Cough: 'your lungs and airway',
    Expectoration: 'your lungs and airway',
    Chest: 'your chest and lungs',
    Heart: 'your heart',
    Back: 'your back',
    Extremities: 'your arms and legs',
    Sleep: 'your sleep',
    Dreams: 'your sleep',
    Chill: 'your body temperature regulation',
    Fever: 'your body temperature regulation',
    Perspiration: 'your sweating and temperature regulation',
    Skin: 'your skin',
    Generalities: 'your overall, whole-body constitution'
  };

  function translateTerm(term) {
    const key = term.toLowerCase().trim().replace(/\.$/, '');
    return PLAIN_TERM_MAP[key] || term;
  }

  // Turns one rubric's mainRubric + qualifierText into a plain-English
  // phrase. Heuristic, not a full language model — handles the common
  // "worse from X" / "better from X" qualifier pattern explicitly, and
  // falls back to a translated comma-list for everything else.
  function formatPlainSymptom(mainRubric, qualifierText) {
    const head = translateTerm(mainRubric);
    if (!qualifierText) return head;

    const rawTokens = qualifierText.split(',').map(t => t.trim()).filter(Boolean);
    const descTokens = [];
    let modalityClauses = [];

    for (const tok of rawTokens) {
      const aggMatch = tok.match(/^(.*?)[,\s]*agg\.?$/i);
      const amelMatch = tok.match(/^(.*?)[,\s]*amel\.?$/i);
      if (aggMatch && aggMatch[1]) {
        modalityClauses.push(`worse from ${translateTerm(aggMatch[1])}`);
      } else if (amelMatch && amelMatch[1]) {
        modalityClauses.push(`better from ${translateTerm(amelMatch[1])}`);
      } else if (/^agg\.?$/i.test(tok)) {
        modalityClauses.push('generally worse');
      } else if (/^amel\.?$/i.test(tok)) {
        modalityClauses.push('generally better');
      } else {
        descTokens.push(translateTerm(tok));
      }
    }

    const descClause = descTokens.length ? ` (${[...new Set(descTokens.map(t => t.toLowerCase()))].join(', ')})` : '';
    const modalityClause = modalityClauses.length ? `, ${modalityClauses.join(', ')}` : '';
    return `${head}${descClause}${modalityClause}`;
  }

  // Selecting a rubric in the tree often also selects its parent/child
  // rubrics, producing several near-duplicate entries that are really
  // one symptom described at different levels of detail (e.g.
  // "eruptions, herpes, zoster" and "eruptions, herpes, zoster, zona,
  // right side" are the same complaint). Collapse: within each
  // chapter+mainRubric group, drop any entry whose qualifierText is a
  // strict prefix of another kept entry's qualifierText, keeping the
  // more specific ones (including divergent siblings, which are
  // genuinely distinct qualifying facts and are both kept).
  function dedupeSymptomRubrics(foundRubrics) {
    const groups = {};
    for (const r of foundRubrics) {
      const key = r.chapter + '|' + r.mainRubric;
      (groups[key] = groups[key] || []).push(r);
    }
    const result = [];
    for (const key in groups) {
      const list = groups[key].slice().sort((a, b) => (b.qualifierText || '').length - (a.qualifierText || '').length);
      const kept = [];
      for (const r of list) {
        const q = r.qualifierText || '';
        const isSubsumed = kept.some(k => q && (k.qualifierText || '').startsWith(q));
        if (!isSubsumed) kept.push(r);
      }
      result.push(...kept);
    }
    return result;
  }

  function buildPatientSymptomList(assembledData) {
    const found = assembledData.rubrics.filter(r => r.found);
    if (!found.length) return null;
    const deduped = dedupeSymptomRubrics(found);
    const lines = deduped.map(r => {
      const organ = CHAPTER_TO_ORGAN_PLAIN[r.chapter] || `your ${r.chapter.toLowerCase()}`;
      const symptom = formatPlainSymptom(r.mainRubric, r.qualifierText);
      return `In ${organ}: ${symptom}.`;
    });
    return lines.join(' ');
  }

  // Part 1: which organs/body areas are involved, in plain terms.
  // Part 2: how the synthesized mechanisms connect those organs to
  // each other (and to metabolic/psychological background factors),
  // rather than describing each organ in isolation.
  function buildBodySystemsExplanation(assembledData) {
    const found = assembledData.rubrics.filter(r => r.found);
    if (!found.length) return null;

    const organNames = [...new Set(found.map(r => CHAPTER_TO_ORGAN_PLAIN[r.chapter] || `your ${r.chapter.toLowerCase()}`))];
    const organsText = organNames.length
      ? `The main areas involved are ${organNames.join(' and ')}.`
      : null;

    const profile = assembledData.mechanismProfile;
    const top = (profile && profile.ranked) ? profile.ranked.filter(m => m.weight > 0).slice(0, 2) : [];

    let connectionText = null;
    if (top.length) {
      const clause1 = PATIENT_MECHANISM_EXPLANATIONS[top[0].mechanism] || `a disturbance related to ${top[0].mechanism.toLowerCase()}`;
      if (top.length === 1) {
        connectionText = `The main driver appears to be that ${clause1}. This directly explains the symptoms described above.`;
      } else {
        const clause2 = PATIENT_MECHANISM_EXPLANATIONS[top[1].mechanism] || `a disturbance related to ${top[1].mechanism.toLowerCase()}`;
        connectionText = `The main driver appears to be that ${clause1}. This is closely linked to a second factor — ${clause2} — ` +
          `meaning these are not two separate problems but different expressions of one connected pattern.`;
      }
      const historyReinforced = top.some(m => m.reinforcedByHistory);
      if (historyReinforced) {
        connectionText += ' Your existing health history fits this same pattern and likely makes your body more prone to it.';
      }
    }

    return [organsText, connectionText].filter(Boolean).join(' ');
  }

  // Short, single-line, organ-matched description of a remedy's known
  // action — deliberately brief, not a paragraph. Only mentions the
  // organ(s) actually affected in this patient's case.
  const SYSTEM_TO_PLAIN_LABEL = {
    Nervous: 'the nervous system',
    Cardiovascular: 'the heart and circulation',
    Digestive: 'the digestive organs',
    Respiratory: 'the lungs and airway',
    Musculoskeletal: 'the muscles and joints',
    Integumentary: 'the skin',
    Reproductive: 'the reproductive organs',
    Urinary: 'the urinary system',
    Sensory: 'the senses (eyes, ears)',
    Constitutional: 'the overall constitution'
  };

  function buildPatientRemedyExplanation(remedyAbbr, assembledData, remedyDB) {
    const content = remedyDB.remedies[remedyAbbr];
    if (!content) {
      return `${remedyAbbr}: a plain-language description is not yet available for this medicine — your doctor will explain this one directly.`;
    }

    const affectedChapters = [...new Set(assembledData.rubrics.filter(r => r.found).map(r => r.chapter))];
    const affectedSystems = new Set(affectedChapters.map(c => systemForChapter(c)).filter(Boolean));

    const matchedAffinity = content.systemAffinities.find(aff => affectedSystems.has(aff.system));
    const topAffinity = content.systemAffinities.slice().sort((a, b) => a.prominence - b.prominence)[0];
    const chosenAffinity = matchedAffinity || topAffinity;

    const organLabel = chosenAffinity ? (SYSTEM_TO_PLAIN_LABEL[chosenAffinity.system] || chosenAffinity.system) : 'your general constitution';
    const shortLine = chosenAffinity
      ? chosenAffinity.pathophysiology.split(/[.;]/)[0].trim()
      : (content.constitutionalNote || '').split(/[.;]/)[0].trim();

    return `${content.fullName} — acts on: ${organLabel}. Known primarily for: ${shortLine}.`;
  }

  function buildCumulativeRemedyStatement(prescribedRemedies, remedyDB) {
    if (!prescribedRemedies.length) return null;
    const names = prescribedRemedies
      .map(abbr => (remedyDB.remedies[abbr] || {}).fullName || abbr)
      .join(', ');
    return `Together, these medicines (${names}) are being considered as a complementary group rather than competing options — ` +
      `each has a documented action on a different part of the same overall pattern described above. Your doctor will decide which ` +
      `one to start with, and in what order or combination, based on the complete picture — but as a group, they represent a ` +
      `well-founded, positive direction aimed at supporting your body's own capacity to recover and restore balance.`;
  }

  function generatePatientFriendlyNarrative(assembledData, remedyDB) {
    const prescribedRemedies = assembledData.remedySummary.map(r => r.remedy);

    const symptomText = buildPatientSymptomList(assembledData);
    const bodySystemsText = buildBodySystemsExplanation(assembledData);
    const remedyLines = prescribedRemedies.map(abbr => buildPatientRemedyExplanation(abbr, assembledData, remedyDB));
    const cumulativeText = buildCumulativeRemedyStatement(prescribedRemedies, remedyDB);

    const openingText = 'Based on what you have described, here is a simple explanation of what may be going on and how your treatment is intended to help.';

    const closingText =
      'This explanation is a starting point prepared for your doctor to review and discuss with you — it is not a final diagnosis, and your doctor may adjust it based on things not captured here.';

    const remedySectionText = [remedyLines.join('\n'), cumulativeText].filter(Boolean).join('\n\n');

    const sections = [
      { title: 'Your Disease Picture', text: symptomText },
      { title: 'What May Be Happening In Your Body', text: bodySystemsText },
      { title: 'What Each Medicine Is Known For, And How It May Help You', text: remedySectionText },
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
