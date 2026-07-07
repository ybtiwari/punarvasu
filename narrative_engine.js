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
  // Per-remedy section
  // ---------------------------------------------------------------

  function buildRemedySection(remedyAbbr, assembledData, remedyDB) {
    const content = remedyDB.remedies[remedyAbbr];
    const remedySummary = assembledData.remedySummary.find(r => r.remedy === remedyAbbr);
    const relevantRubrics = assembledData.rubrics.filter(
      r => r.found && r.prescribedRemedyMatches.some(m => m.remedy === remedyAbbr)
    );

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

    // Match remedy's system affinities against systems actually present in this case
    const affinityMatches = [];
    for (const aff of content.systemAffinities) {
      const rubricsInSystem = relevantRubrics.filter(r => systemForChapter(r.chapter) === aff.system);
      if (rubricsInSystem.length) {
        affinityMatches.push({ aff, rubricsInSystem });
      }
    }

    if (affinityMatches.length) {
      for (const { aff, rubricsInSystem } of affinityMatches) {
        const evidence = rubricsInSystem.map(r => describeRubricEvidence(r, remedyAbbr)).join('; ');
        lines.push(
          `${aff.system} affinity (rank ${aff.prominence} for this remedy): ${aff.pathophysiology} ` +
          `Supported by: ${evidence}.`
        );
      }
    } else {
      lines.push(
        `Note: none of this remedy's documented system affinities (${content.systemAffinities.map(a => a.system).join(', ')}) ` +
        `directly overlap with the chapters selected in this case (${[...new Set(relevantRubrics.map(r => r.chapter))].join(', ') || 'none'}). ` +
        `Review whether the prescription rests on generals/constitutional grounds rather than the local rubrics captured here.`
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
