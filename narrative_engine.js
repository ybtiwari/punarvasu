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

  // ---------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------

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
  global.renderNarrativeText = renderNarrativeText;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateEvidenceBasedNarrative, renderNarrativeText, CHAPTER_TO_SYSTEM };
  }

})(typeof window !== 'undefined' ? window : globalThis);
