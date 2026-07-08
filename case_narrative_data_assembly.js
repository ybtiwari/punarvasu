/*
  case_narrative_data_assembly.js
  ---------------------------------------------------------------
  Punarvasu Clinic — "Generate Case Narrative" feature
  LAYER 1: Data assembly (deterministic, no AI)

  Purpose:
  Given a case's selected rubrics, the remedies prescribed, and
  patient history, assemble a structured JSON payload that Layer 2
  (the Claude API narrative-generation prompt) will consume. No
  prose is written here — only facts pulled from repertory_data.js
  and symptom_affinity_table_v2.json.

  Expected globals (already loaded by the repertorization engine
  the same way it loads them today):
    EMBEDDED_DATA.rubrics   -> array of [id, pathString, remedyPairs]
                               pathString = "Chapter, main rubric, qualifier text..."
                               remedyPairs = [[abbr, grade], ...]  grade in {1,2,3}
    EMBEDDED_DATA.remedies  -> array of remedy records (abbr-indexed elsewhere)
    symptomAffinityTable    -> array from symptom_affinity_table_v2.json
                               { chapter, symptom_a, symptom_b, jaccard, shared_remedy_count, ... }

  This file exports one entry point: assembleCaseNarrativeData(input)

  NOTE ON CALIBRATION:
  The qualifier keyword sets and rarity thresholds below are a first
  pass based on the seven qualifier categories already established
  (Sensation, Cause, Timing, Modality, Content, Laterality, Sequence).
  They have not been run against the live 74,667-rubric set yet.
  Treat QUALIFIER_PATTERNS and RARITY_THRESHOLDS as the two things to
  tune once we test this against real cases — everything downstream
  is deterministic, so fixing these two spots fixes the whole layer.
*/

(function (global) {
  'use strict';

  // ---------------------------------------------------------------
  // Config: tune these two blocks against real data before relying
  // on the output clinically.
  // ---------------------------------------------------------------

  const QUALIFIER_PATTERNS = {
    Laterality: /\b(right|left|one side|alternating sides|side to side)\b/i,
    Timing: /\b(morning|forenoon|noon|afternoon|evening|night|midnight|before|after|during|periodic|every|annually|monthly|daily|hourly)\b/i,
    Modality: /\b(agg\.?|amel\.?|better|worse|from|during|while|motion|rest|touch|pressure|open air|warm|cold|damp|eating|lying|standing|sitting)\b/i,
    Cause: /\b(from|after|ailments from|due to|following|induced by)\b/i,
    Sequence: /\b(alternating with|followed by|preceded by|then)\b/i,
    Content: /\b(as if|as from|sensation of|like|as though)\b/i,
    Sensation: /\b(pain|ache|burning|stitching|cutting|tearing|throbbing|pressing|drawing|numbness|itching|heaviness|constriction|tension)\b/i
  };

  const RARITY_THRESHOLDS = {
    rare: 3,       // rubric total remedy count <= 3
    uncommon: 15   // <= 15 => uncommon, otherwise common
  };

  // ---------------------------------------------------------------
  // Internal indices — built once, lazily, from EMBEDDED_DATA
  // ---------------------------------------------------------------

  let _rubricById = null;
  let _rubricByPath = null;

  function ensureIndices() {
    if (_rubricById) return;
    _rubricById = new Map();
    _rubricByPath = new Map();
    // EMBEDDED_DATA may be declared with let/const in another <script> tag, in which
    // case it is NOT attached to window/global — but it IS visible by bare name here,
    // since all classic (non-module) scripts on a page share one global lexical scope.
    let dataSource = null;
    try {
      if (typeof EMBEDDED_DATA !== 'undefined') dataSource = EMBEDDED_DATA;
    } catch (e) { /* not defined in this scope */ }
    if (!dataSource) dataSource = global.EMBEDDED_DATA || (typeof DB !== 'undefined' ? DB : null);
    const rubrics = (dataSource && dataSource.rubrics) || [];
    for (const r of rubrics) {
      const [id, path] = r;
      _rubricById.set(id, r);
      _rubricByPath.set(path, r);
    }
  }

  function lookupRubric(rubricIdOrPath) {
    ensureIndices();
    if (_rubricById.has(rubricIdOrPath)) return _rubricById.get(rubricIdOrPath);
    if (_rubricByPath.has(rubricIdOrPath)) return _rubricByPath.get(rubricIdOrPath);
    return null;
  }

  function splitPath(pathString) {
    const parts = pathString.split(',').map(p => p.trim());
    return {
      chapter: parts[0] || '',
      mainRubric: parts[1] || '',
      qualifierText: parts.slice(2).join(', ')
    };
  }

  function classifyQualifiers(qualifierText) {
    if (!qualifierText) return [];
    const tags = [];
    for (const [tag, pattern] of Object.entries(QUALIFIER_PATTERNS)) {
      if (pattern.test(qualifierText)) tags.push(tag);
    }
    return tags;
  }

  function classifyRarity(remedyCount) {
    if (remedyCount <= RARITY_THRESHOLDS.rare) return 'rare';
    if (remedyCount <= RARITY_THRESHOLDS.uncommon) return 'uncommon';
    return 'common';
  }

  // ---------------------------------------------------------------
  // Per-rubric assembly
  // ---------------------------------------------------------------

  function assembleRubric(rubricIdOrPath, prescribedRemedies) {
    const record = lookupRubric(rubricIdOrPath);
    if (!record) {
      return {
        input: rubricIdOrPath,
        found: false,
        error: 'Rubric not found in EMBEDDED_DATA — check id/path against current dataset.'
      };
    }

    const [id, path, remedyPairs] = record;
    const { chapter, mainRubric, qualifierText } = splitPath(path);
    const qualifierTags = classifyQualifiers(qualifierText);
    const mechanismTags = (typeof classifyMechanisms === 'function') ? classifyMechanisms(path) : [];
    const remedyCount = remedyPairs.length;
    const rarity = classifyRarity(remedyCount);

    const grade3Remedies = remedyPairs.filter(([, g]) => g === 3).map(([a]) => a);

    const prescribedInThisRubric = prescribedRemedies
      .map(abbr => {
        const match = remedyPairs.find(([a]) => a.toLowerCase() === abbr.toLowerCase());
        if (!match) return null;
        const [, grade] = match;
        const isSole = remedyCount === 1 || (grade === 3 && grade3Remedies.length === 1);
        return { remedy: abbr, grade, isSoleRemedy: isSole };
      })
      .filter(Boolean);

    return {
      input: rubricIdOrPath,
      found: true,
      rubricId: id,
      path,
      chapter,
      mainRubric,
      qualifierText,
      qualifierTags,
      mechanismTags,
      totalRemedyCount: remedyCount,
      rarity,
      grade3RemedyCount: grade3Remedies.length,
      prescribedRemedyMatches: prescribedInThisRubric
    };
  }

  // ---------------------------------------------------------------
  // Affinity cross-check across the selected rubric set
  // ---------------------------------------------------------------

  function findAffinityLinks(assembledRubrics, affinityTable) {
    const links = [];
    const table = affinityTable || global.symptomAffinityTable || [];
    if (!table.length) return links;

    for (let i = 0; i < assembledRubrics.length; i++) {
      for (let j = i + 1; j < assembledRubrics.length; j++) {
        const a = assembledRubrics[i];
        const b = assembledRubrics[j];
        if (!a.found || !b.found) continue;
        if (a.chapter !== b.chapter) continue; // affinity table is chapter-scoped

        const match = table.find(entry =>
          entry.chapter === a.chapter &&
          ((entry.symptom_a === a.mainRubric && entry.symptom_b === b.mainRubric) ||
           (entry.symptom_a === b.mainRubric && entry.symptom_b === a.mainRubric))
        );

        if (match) {
          links.push({
            chapter: a.chapter,
            symptomA: a.mainRubric,
            symptomB: b.mainRubric,
            jaccard: match.jaccard,
            sharedRemedyCount: match.shared_remedy_count
          });
        }
      }
    }
    return links;
  }

  // ---------------------------------------------------------------
  // Remedy-level summary across the whole selected rubric set
  // ---------------------------------------------------------------

  function summarizeRemedies(assembledRubrics, prescribedRemedies) {
    const summary = {};
    for (const abbr of prescribedRemedies) {
      summary[abbr] = {
        remedy: abbr,
        rubricsCovered: 0,
        grade3Count: 0,
        grade2Count: 0,
        grade1Count: 0,
        soleRemedyCount: 0,
        chapters: new Set(),
        rareRubricCount: 0
      };
    }

    for (const r of assembledRubrics) {
      if (!r.found) continue;
      for (const match of r.prescribedRemedyMatches) {
        const s = summary[match.remedy];
        if (!s) continue;
        s.rubricsCovered += 1;
        s.chapters.add(r.chapter);
        if (match.grade === 3) s.grade3Count += 1;
        if (match.grade === 2) s.grade2Count += 1;
        if (match.grade === 1) s.grade1Count += 1;
        if (match.isSoleRemedy) s.soleRemedyCount += 1;
        if (r.rarity === 'rare') s.rareRubricCount += 1;
      }
    }

    return Object.values(summary).map(s => ({
      ...s,
      chapters: Array.from(s.chapters)
    }));
  }

  // ---------------------------------------------------------------
  // Mechanism synthesis across the whole case
  // ---------------------------------------------------------------

  const RARITY_WEIGHT = { rare: 3, uncommon: 1.5, common: 1 };

  function synthesizeMechanismProfile(assembledRubrics, patientHistory) {
    const scores = {}; // mechanism -> { weight, rubrics: Set }

    for (const r of assembledRubrics) {
      if (!r.found) continue;
      const w = RARITY_WEIGHT[r.rarity] || 1;
      for (const mech of r.mechanismTags) {
        if (!scores[mech]) scores[mech] = { weight: 0, rubrics: new Set() };
        scores[mech].weight += w;
        scores[mech].rubrics.add(r.mainRubric || r.path);
      }
    }

    const historyText = (patientHistory && (patientHistory.notes || patientHistory.freetext || '')) || '';
    const comorbidityMechanisms = (typeof classifyComorbidityMechanisms === 'function')
      ? classifyComorbidityMechanisms(historyText)
      : [];
    for (const mech of comorbidityMechanisms) {
      if (!scores[mech]) scores[mech] = { weight: 0, rubrics: new Set() };
      scores[mech].weight += 1; // background predisposition, lighter weight than a presenting rubric
    }

    const ranked = Object.entries(scores)
      .map(([mechanism, data]) => ({
        mechanism,
        weight: Math.round(data.weight * 10) / 10,
        supportingRubrics: Array.from(data.rubrics),
        reinforcedByHistory: comorbidityMechanisms.includes(mechanism)
      }))
      .sort((a, b) => b.weight - a.weight);

    return { ranked, comorbidityMechanisms };
  }


  function assembleCaseNarrativeData(input) {
    const {
      rubricIds = [],
      prescribedRemedies = [],
      patientHistory = {},
      affinityTable = null
    } = input || {};

    const assembledRubrics = rubricIds.map(id => assembleRubric(id, prescribedRemedies));
    const affinityLinks = findAffinityLinks(assembledRubrics, affinityTable);
    const remedySummary = summarizeRemedies(assembledRubrics, prescribedRemedies);
    const mechanismProfile = synthesizeMechanismProfile(assembledRubrics, patientHistory);

    const unresolvedRubrics = assembledRubrics.filter(r => !r.found).map(r => r.input);

    return {
      generatedAt: new Date().toISOString(),
      rubrics: assembledRubrics,
      affinityLinks,
      remedySummary,
      mechanismProfile,
      patientHistory,
      warnings: unresolvedRubrics.length
        ? [`${unresolvedRubrics.length} rubric(s) could not be resolved: ${unresolvedRubrics.join('; ')}`]
        : []
    };
  }

  // Expose for browser (single-file HTML app pattern) and for Node testing
  global.assembleCaseNarrativeData = assembleCaseNarrativeData;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { assembleCaseNarrativeData, classifyQualifiers, classifyRarity, splitPath };
  }

})(typeof window !== 'undefined' ? window : globalThis);
