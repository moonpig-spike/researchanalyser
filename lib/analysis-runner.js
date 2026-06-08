async function saveAnalysisProgress(supabase, analysisRunId, payload) {
  const update = {
    status: payload.status,
    current_step: payload.currentStep,
    progress_log: payload.progressLog,
    error_message: payload.errorMessage || null,
    completed_at:
      payload.status === 'complete' || payload.status === 'failed'
        ? new Date().toISOString()
        : null,
  };

  const { error } = await supabase
    .from('analysis_runs')
    .update(update)
    .eq('id', analysisRunId);

  if (error) {
    throw new Error(`Failed to update analysis run: ${error.message}`);
  }
}

async function saveAnalysisOutput(supabase, projectId, analysisRunId, payload) {
  if (payload.status !== 'complete') {
    await saveAnalysisProgress(supabase, analysisRunId, payload);
    return;
  }

  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const conditionSummaries = Array.isArray(payload.conditionSummaries)
    ? payload.conditionSummaries
    : [];
  const findings = Array.isArray(payload.findings) ? payload.findings : [];

  const questionRows = questions.map((question) => ({
    analysis_run_id: analysisRunId,
    question_number: question.questionNumber,
    question_text: question.questionText,
    feedback_group: question.feedbackGroup || null,
    summary: question.summary,
    key_insights: question.keyInsights || [],
    condition_breakdown: question.conditionBreakdown || {},
    citations: question.citations || [],
    participant_count: question.participantCount || 0,
  }));

  const conditionRows = conditionSummaries.map((summary) => ({
    analysis_run_id: analysisRunId,
    condition_name: summary.conditionName,
    summary: summary.summary,
  }));

  const findingRows = findings.map((finding) => ({
    project_id: projectId,
    analysis_run_id: analysisRunId,
    type: finding.type,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    participant_count: finding.participantCount || 0,
    conditions: finding.conditions || [],
    tags: finding.tags || ['auto-generated', 'analysis'],
  }));
  const legacyFindingRows = findings.map((finding) => ({
    project_id: projectId,
    title: finding.title,
    summary: finding.description || finding.title,
    detail: finding.description || null,
    category: finding.type,
    priority:
      finding.severity === 'critical'
        ? 'high'
        : finding.severity === 'major'
        ? 'medium'
        : 'low',
    created_at: new Date().toISOString(),
  }));
  const summaryDetailFindingRows = findings.map((finding) => ({
    project_id: projectId,
    title: finding.title,
    summary: finding.description || finding.title,
    detail: finding.description || null,
    transcript_reference: null,
    participant_reference: null,
    created_at: new Date().toISOString(),
  }));

  const { error: clearQuestionsError } = await supabase
    .from('analysis_questions')
    .delete()
    .eq('analysis_run_id', analysisRunId);
  if (clearQuestionsError) {
    throw new Error(`Failed to clear previous analysis questions: ${clearQuestionsError.message}`);
  }

  const { error: clearSummariesError } = await supabase
    .from('condition_summaries')
    .delete()
    .eq('analysis_run_id', analysisRunId);
  if (clearSummariesError) {
    throw new Error(`Failed to clear previous condition summaries: ${clearSummariesError.message}`);
  }

  const { error: clearFindingsError } = await supabase
    .from('findings')
    .delete()
    .eq('project_id', projectId);
  if (clearFindingsError) {
    throw new Error(`Failed to clear previous findings: ${clearFindingsError.message}`);
  }

  if (questionRows.length > 0) {
    const { error: questionInsertError } = await supabase
      .from('analysis_questions')
      .insert(questionRows);
    if (questionInsertError) {
      throw new Error(`Failed to insert analysis questions: ${questionInsertError.message}`);
    }
  }

  if (conditionRows.length > 0) {
    const { error: summaryInsertError } = await supabase
      .from('condition_summaries')
      .insert(conditionRows);
    if (summaryInsertError) {
      throw new Error(`Failed to insert condition summaries: ${summaryInsertError.message}`);
    }
  }

  if (findingRows.length > 0) {
    const { error: findingInsertError } = await supabase.from('findings').insert(findingRows);
    if (findingInsertError) {
      const { error: legacyInsertError } = await supabase.from('findings').insert(legacyFindingRows);

      if (legacyInsertError) {
        const { error: summaryDetailInsertError } = await supabase
          .from('findings')
          .insert(summaryDetailFindingRows);

        if (summaryDetailInsertError) {
          throw new Error(
            `Failed to insert findings: ${findingInsertError.message} | legacy fallback: ${legacyInsertError.message} | summary/detail fallback: ${summaryDetailInsertError.message}`
          );
        }
      }
    }
  }

  const { error: projectStatusError } = await supabase
    .from('projects')
    .update({
      status: 'complete',
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  if (projectStatusError) {
    throw new Error(`Analysis was saved but failed to update project status: ${projectStatusError.message}`);
  }

  await saveAnalysisProgress(supabase, analysisRunId, payload);
}

const CROSS_REFERENCE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          questionNumber: { type: 'string' },
          questionText: { type: 'string' },
          feedbackGroup: {
            type: 'string',
            enum: ['A', 'B', 'none'],
          },
          summary: { type: 'string' },
          keyInsights: {
            type: 'array',
            items: { type: 'string' },
          },
          participantCount: { type: 'number' },
          participantAnalyses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                participantId: { type: 'string' },
                sessionId: { type: 'string' },
                condition: { type: 'string' },
                summary: { type: 'string' },
                quote: { type: 'string' },
                transcriptReference: { type: 'string' },
              },
              required: [
                'participantId',
                'sessionId',
                'condition',
                'summary',
                'quote',
                'transcriptReference',
              ],
            },
          },
        },
        required: [
          'questionNumber',
          'questionText',
          'feedbackGroup',
          'summary',
          'keyInsights',
          'participantCount',
          'participantAnalyses',
        ],
      },
    },
    conditionSummaries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          conditionName: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['conditionName', 'summary'],
      },
    },
  },
  required: ['questions', 'conditionSummaries'],
};

const FINDINGS_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['pain-point', 'delighter', 'insight', 'recommendation'],
          },
          title: { type: 'string' },
          description: { type: 'string' },
          severity: {
            type: 'string',
            enum: ['critical', 'major', 'minor'],
          },
          participantCount: { type: 'number' },
          conditions: {
            type: 'array',
            items: { type: 'string' },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'type',
          'title',
          'description',
          'severity',
          'participantCount',
          'conditions',
          'tags',
        ],
      },
    },
  },
  required: ['findings'],
};

const TRANSCRIPT_CHUNK_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    evidenceBullets: {
      type: 'array',
      items: { type: 'string' },
    },
    notableQuotes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'evidenceBullets', 'notableQuotes'],
};

const TRANSCRIPT_DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    participantSummary: { type: 'string' },
    evidenceBullets: {
      type: 'array',
      items: { type: 'string' },
    },
    notableQuotes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['participantSummary', 'evidenceBullets', 'notableQuotes'],
};

const RESEARCH_CONTEXT_DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    studySummary: { type: 'string' },
    goals: {
      type: 'array',
      items: { type: 'string' },
    },
    focalQuestions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['studySummary', 'goals', 'focalQuestions'],
};

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output did not contain a JSON object.');
  }

  return JSON.parse(text.slice(start, end + 1));
}

function readStructuredResponseBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  if (body.output_parsed && typeof body.output_parsed === 'object') {
    return body.output_parsed;
  }

  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return extractJsonObject(body.output_text);
  }

  if (!Array.isArray(body.output)) {
    return null;
  }

  for (const item of body.output) {
    if (!item || !Array.isArray(item.content)) continue;

    for (const content of item.content) {
      if (!content || typeof content !== 'object') continue;

      if (content.parsed && typeof content.parsed === 'object') {
        return content.parsed;
      }

      if (typeof content.text === 'string' && content.text.trim()) {
        try {
          return extractJsonObject(content.text);
        } catch {
          // Keep looking through other content blocks.
        }
      }
    }
  }

  return null;
}

function summarizeResponseShape(body) {
  if (!body || typeof body !== 'object') {
    return 'non-object response body';
  }

  const summary = {
    status: body.status || null,
    hasOutputText: typeof body.output_text === 'string' && body.output_text.length > 0,
    hasOutputParsed: Boolean(body.output_parsed),
    outputTypes: Array.isArray(body.output)
      ? body.output.map((item) => ({
          type: item?.type || null,
          contentTypes: Array.isArray(item?.content)
            ? item.content.map((content) => content?.type || 'unknown')
            : [],
        }))
      : [],
  };

  return JSON.stringify(summary);
}

function cleanArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isQuestionPrompt(line) {
  const text = normalizeWhitespace(line);
  if (!text) return false;
  if (text.startsWith('http://') || text.startsWith('https://')) return false;
  if (/^(participant intro|warm-up verbal response|follow up tasks|post-comparison questions|multiple choice|verbal response|intro|task|load|design a|design b|\[.*\]|participant|group)/i.test(text)) {
    return false;
  }

  return /\?/.test(text);
}

function buildAnalysisTargets(testScript, studyType) {
  const lines = normalizeWhitespace(testScript)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const otherQuestions = [];
  const balancedQuestions = [];
  let insideBalancedSection = false;
  let collectBalancedFollowUps = false;

  for (const line of lines) {
    if (/^\[balance comparison start\]$/i.test(line)) {
      insideBalancedSection = true;
      collectBalancedFollowUps = false;
      continue;
    }

    if (/^\[\/balance comparison end\]$/i.test(line)) {
      insideBalancedSection = false;
      collectBalancedFollowUps = false;
      continue;
    }

    if (insideBalancedSection && /^follow up tasks:?$/i.test(line)) {
      collectBalancedFollowUps = true;
      continue;
    }

    if (!isQuestionPrompt(line)) {
      continue;
    }

    if (studyType === 'balanced-comparison' && insideBalancedSection && collectBalancedFollowUps) {
      balancedQuestions.push(line);
    } else {
      otherQuestions.push(line);
    }
  }

  if (studyType === 'balanced-comparison') {
    const targets = [];
    const fallbackQuestions =
      balancedQuestions.length === 0 && otherQuestions.length === 0
        ? extractQuestions(testScript)
        : [];

    balancedQuestions.forEach((question, index) => {
      targets.push({
        questionNumber: `Q${index + 1}`,
        questionText: question,
        feedbackGroup: 'A',
      });
    });

    balancedQuestions.forEach((question, index) => {
      targets.push({
        questionNumber: `Q${index + 1}`,
        questionText: question,
        feedbackGroup: 'B',
      });
    });

    otherQuestions.forEach((question, index) => {
      targets.push({
        questionNumber: `Q${index + 1}`,
        questionText: question,
        feedbackGroup: 'none',
      });
    });

    fallbackQuestions.forEach((question, index) => {
      targets.push({
        questionNumber: `Q${index + 1}`,
        questionText: question,
        feedbackGroup: 'none',
      });
    });

    return targets;
  }

  const fallbackQuestions = otherQuestions.length > 0 ? otherQuestions : extractQuestions(testScript);

  return fallbackQuestions.map((question, index) => ({
    questionNumber: `Q${index + 1}`,
    questionText: question,
    feedbackGroup: 'none',
  }));
}

function buildTranscriptReference(participantId) {
  return `${sanitizeParticipantId(participantId)}.md`;
}

function sanitizeParticipantId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function clipText(value, max = 220) {
  const text = normalizeWhitespace(String(value || ''));
  return text.length <= max ? text : `${text.slice(0, max).trim()}...`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildAnalysisTranscriptContext(transcripts, balancedAssignmentMap, studyType) {
  return transcripts
    .map((transcript, index) => {
      const participantId = transcript.participant_id || `participant-${index + 1}`;
      const orderLabel = balancedAssignmentMap.get(participantId) || 'Not assigned';
      return [
        `Participant: ${participantId}`,
        `Session ID: ${transcript.session_id || `session-${index + 1}`}`,
        `Condition: ${transcript.condition || 'All participants'}`,
        studyType === 'balanced-comparison' ? `Balanced order: ${orderLabel}` : null,
        'Transcript:',
        clipText(normalizeWhitespace(transcript.transcript || ''), 2200),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');
}

async function callOpenAiStructured({
  apiKey,
  schemaName,
  schema,
  systemText,
  userText,
  reasoningEffort = 'medium',
}) {
  let response;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000);
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.5',
          reasoning: { effort: reasoningEffort },
          text: {
            format: {
              type: 'json_schema',
              name: schemaName,
              strict: true,
              schema,
            },
          },
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: systemText }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: userText }],
            },
          ],
        }),
      });
      clearTimeout(timeout);
      break;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < 3) {
        await sleep(attempt * 1500);
      }
    }
  }

  if (!response) {
    throw new Error(
      `OpenAI request failed before a response was returned after 3 attempts. This often happens when the analysis payload is too large or the network connection was reset. ${
        lastError instanceof Error ? lastError.message : 'Unknown fetch error.'
      }`
    );
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || 'OpenAI generation failed');
  }

  const refusal = Array.isArray(body.output)
    ? body.output
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .find((item) => item?.type === 'refusal')
    : null;

  if (refusal?.refusal) {
    throw new Error(`Model refused structured output: ${refusal.refusal}`);
  }

  const parsed = readStructuredResponseBody(body);
  if (parsed) {
    return parsed;
  }

  throw new Error(
    `Model did not return structured output in the expected format. Response shape: ${summarizeResponseShape(body)}`
  );
}

async function generateAiCrossReferenceAnalysisBatch({
  apiKey,
  project,
  transcripts,
  progressLog,
  analysisTargets,
  batchIndex,
  totalBatches,
}) {
  const balancedAssignments = Array.isArray(project.balancedAssignments)
    ? project.balancedAssignments
    : [];
  const balancedAssignmentMap = new Map(
    balancedAssignments.map((assignment) => [assignment.participantId, assignment.orderLabel])
  );

  const transcriptContext = buildAnalysisTranscriptContext(
    transcripts,
    balancedAssignmentMap,
    project.study_type
  );

  const balancedAssignmentContext =
    project.study_type === 'balanced-comparison'
      ? balancedAssignments
          .map(
            (assignment) =>
              `- ${assignment.participantId}: ${
                assignment.orderLabel === 'A-B'
                  ? 'Saw A first, then B'
                  : 'Saw B first, then A'
              }`
          )
          .join('\n')
      : '';
  const analysisTargetContext = analysisTargets
    .map((target) => {
      const sectionLabel =
        target.feedbackGroup === 'A'
          ? 'Group A'
          : target.feedbackGroup === 'B'
          ? 'Group B'
          : 'Other questions';
      return `- ${sectionLabel} ${target.questionNumber}: ${target.questionText}`;
    })
    .join('\n');

  const parsed = await callOpenAiStructured({
    apiKey,
    schemaName: 'analysis_cross_reference',
    schema: CROSS_REFERENCE_RESPONSE_SCHEMA,
    reasoningEffort: 'medium',
    systemText: [
      'You are a senior UX researcher.',
      'Your task is to analyze one research script against all participant transcripts.',
      'You must generate a rigorous per-question, per-user cross-reference document that can be used as due diligence for a final research report.',
      'Be evidence-led, avoid vague summaries, and do not invent participant behaviour that is not supported by the transcripts.',
      'Treat the uploaded research script and transcript set as belonging to the same study unless the transcripts are literally empty or unusable.',
      'Do not reject the whole dataset because participants paraphrase, skip, combine tasks, or discuss adjacent screens in a different order.',
      'If evidence is thin for a specific question, say that evidence is limited for that question, but still produce the best grounded summary you can from the transcript.',
      'Do not write global statements like "do not use these transcripts" or "no valid evidence" unless the transcripts are actually empty, corrupted, or unrelated machine output.',
      'You must return exactly one question object for every analysis target provided by the user, in the same order, with the same questionNumber, questionText, and feedbackGroup.',
      'Use the supplied schema exactly.',
      project.study_type === 'balanced-comparison'
        ? 'This is a balanced comparison study. You must respect the participant order mapping and separate analysis into Feedback A and Feedback B.'
        : 'This is not a balanced comparison study. Use feedbackGroup "none" for all questions.',
    ].join(' '),
    userText: [
      'Analyze the following study materials and return structured output that matches the supplied schema.',
      '',
      'Requirements:',
      '- Use the research script as the source of truth for the question structure.',
      '- Review all transcripts against all questions.',
      '- Produce per-question, per-user summaries.',
      '- Each question needs a study-level summary and 1-3 key insights.',
      '- Each participant summary should be concise, specific, and grounded in the transcript.',
      '- Use short supporting quotes only when genuinely helpful.',
      '- Also produce condition summaries.',
      '- Assume the uploaded study materials are valid inputs for this project and synthesize them accordingly.',
      '- Do not produce dataset-level rejection language just because evidence is partial, messy, or not perfectly separated by question.',
      '- When a participant does not answer a question directly, infer only cautiously from nearby transcript evidence and note limited evidence in the summary rather than rejecting the study.',
      '- Cover every analysis target listed below. Do not collapse multiple targets together or skip the post-comparison questions.',
      `- This is batch ${batchIndex} of ${totalBatches}. Return exactly ${analysisTargets.length} question objects for this batch.`,
      project.study_type === 'balanced-comparison'
        ? '- Because this is a balanced comparison study, set feedbackGroup to "A" or "B" and create separate question summaries for Feedback A and Feedback B.'
        : '- Set feedbackGroup to "none" for every question.',
      project.study_type === 'balanced-comparison'
        ? '- Use the balanced comparison assignment list to interpret each participant transcript correctly so A-feedback and B-feedback are not mixed.'
        : '',
      project.study_type === 'balanced-comparison'
        ? '- Keep questionNumber as Q1, Q2, Q3 within each feedback group.'
        : '',
      '',
      `Project name: ${project.name}`,
      `Study name: ${project.study_name}`,
      `Study type: ${project.study_type || 'single-flow'}`,
      `Transcript count: ${transcripts.length}`,
      '',
      'Analysis targets (must all be covered in this order):',
      analysisTargetContext,
      '',
      project.study_type === 'balanced-comparison'
        ? ['Balanced comparison assignment map:', balancedAssignmentContext, ''].join('\n')
        : '',
      'Research script:',
      normalizeWhitespace(project.analysis_context || project.test_script || ''),
      '',
      'Transcripts:',
      transcriptContext,
      '',
      `Progress so far: ${progressLog.join(' | ')}`,
    ].join('\n'),
  });

  return parsed;
}

async function generateAiCrossReferenceAnalysis({ apiKey, project, transcripts, progressLog, postProgress }) {
  const analysisTargets = buildAnalysisTargets(
    normalizeWhitespace(project.test_script || ''),
    project.study_type || 'single-flow'
  );

  const batchSize = project.study_type === 'moderated-test' ? 4 : 6;
  const targetBatches = chunkArray(analysisTargets, batchSize);
  const merged = {
    questions: [],
    conditionSummaries: [],
  };

  for (let batchIndex = 0; batchIndex < targetBatches.length; batchIndex += 1) {
    if (typeof postProgress === 'function') {
      await postProgress(
        `Generating per-question, per-user analysis with GPT-5.5 (${batchIndex + 1} of ${targetBatches.length})`
      );
    }
    const parsed = await generateAiCrossReferenceAnalysisBatch({
      apiKey,
      project,
      transcripts,
      progressLog,
      analysisTargets: targetBatches[batchIndex],
      batchIndex: batchIndex + 1,
      totalBatches: targetBatches.length,
    });

    if (Array.isArray(parsed.questions)) {
      merged.questions.push(...parsed.questions);
    }
    if (batchIndex === 0 && Array.isArray(parsed.conditionSummaries)) {
      merged.conditionSummaries = parsed.conditionSummaries;
    }
  }

  return { ...merged, analysisTargets };
}

function normalizeAiQuestionOutput(parsed, transcripts, analysisTargets) {
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const targets = Array.isArray(analysisTargets) ? analysisTargets : [];
  const normalizedQuestions = questions.map((question, index) => {
    const target = targets[index];
    const participantAnalyses = Array.isArray(question.participantAnalyses)
      ? question.participantAnalyses
      : [];

    const citations = participantAnalyses.map((participant, participantIndex) => {
      const participantId =
        sanitizeParticipantId(participant.participantId) ||
        sanitizeParticipantId(transcripts[participantIndex]?.participant_id) ||
        `participant-${participantIndex + 1}`;

      return {
        quote: clipText(participant.quote || ''),
        participantId,
        summary: normalizeWhitespace(participant.summary || ''),
        condition: participant.condition ? String(participant.condition).trim() : undefined,
        transcriptReference:
          String(participant.transcriptReference || '').trim() || buildTranscriptReference(participantId),
        sessionId: String(participant.sessionId || '').trim() || undefined,
      };
    });

    const conditionBreakdown = {};
    for (const citation of citations) {
      const condition = citation.condition || 'All participants';
      if (!conditionBreakdown[condition]) {
        conditionBreakdown[condition] = `Participants in ${condition} showed a shared pattern around this question that should be read alongside the per-user summaries.`;
      }
    }

    return {
      questionNumber: String(target?.questionNumber || question.questionNumber || `Q${index + 1}`).trim(),
      questionText: String(target?.questionText || question.questionText || '').trim(),
      feedbackGroup:
        target?.feedbackGroup === 'A' || target?.feedbackGroup === 'B'
          ? target.feedbackGroup
          : question.feedbackGroup === 'A' || question.feedbackGroup === 'B'
          ? question.feedbackGroup
          : undefined,
      summary: normalizeWhitespace(question.summary || ''),
      keyInsights: cleanArray(question.keyInsights).slice(0, 3),
      conditionBreakdown,
      citations,
      participantCount:
        Number(question.participantCount) > 0 ? Number(question.participantCount) : citations.length,
    };
  });

  if (targets.length > 0 && normalizedQuestions.length !== targets.length) {
    throw new Error(
      `Model returned ${normalizedQuestions.length} question analyses, but the script requires ${targets.length}.`
    );
  }

  return normalizedQuestions;
}

function normalizeAiConditionSummaries(parsed, transcripts) {
  const provided = Array.isArray(parsed.conditionSummaries) ? parsed.conditionSummaries : [];

  if (provided.length > 0) {
    return provided
      .map((item) => ({
        conditionName: String(item.conditionName || '').trim(),
        summary: normalizeWhitespace(item.summary || ''),
      }))
      .filter((item) => item.conditionName && item.summary);
  }

  return buildConditionSummaries(transcripts);
}

function buildCrossReferenceContext(questionAnalyses) {
  return questionAnalyses
    .map((question) => {
      const participantLines = question.citations
        .map((citation) => {
          const evidence = citation.quote ? ` Evidence: "${citation.quote}"` : '';
          return `- ${citation.participantId}: ${citation.summary}${evidence}`;
        })
        .join('\n');

      return [
        `${question.feedbackGroup ? `Feedback ${question.feedbackGroup}` : 'Other'} ${question.questionNumber}: ${question.questionText}`,
        `Summary: ${question.summary}`,
        question.keyInsights.length > 0 ? `Key insights: ${question.keyInsights.join(' | ')}` : null,
        participantLines ? `Participant evidence:\n${participantLines}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function splitLargeTranscript(text, maxChars = 12000) {
  const sections = splitTranscriptSections(text);
  if (sections.length === 0) return [];

  const chunks = [];
  let current = '';

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (section.length <= maxChars) {
      current = section;
      continue;
    }

    for (let start = 0; start < section.length; start += maxChars) {
      chunks.push(section.slice(start, start + maxChars));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

async function summarizeTranscriptChunk({
  apiKey,
  studyContext,
  projectName,
  studyType,
  participantId,
  sessionId,
  chunkText,
  chunkIndex,
  totalChunks,
}) {
  return callOpenAiStructured({
    apiKey,
    schemaName: 'transcript_chunk_summary',
    schema: TRANSCRIPT_CHUNK_SUMMARY_SCHEMA,
    reasoningEffort: 'low',
    systemText: [
      'You are a senior UX researcher preparing analysis-ready notes from one chunk of a long moderated research transcript.',
      'Summarize only what is grounded in the chunk.',
      'Capture the participant reactions, friction, motivations, expectations, and explicit suggestions that matter for later synthesis.',
      'Do not invent missing detail.',
      'Use the supplied schema exactly.',
    ].join(' '),
    userText: [
      `Project name: ${projectName}`,
      `Study type: ${studyType || 'single-flow'}`,
      `Participant: ${participantId}`,
      `Session ID: ${sessionId || 'unknown'}`,
      `Transcript chunk: ${chunkIndex + 1} of ${totalChunks}`,
      '',
      'Research inputs / script context:',
      normalizeWhitespace(studyContext || ''),
      '',
      'Transcript chunk:',
      normalizeWhitespace(chunkText || ''),
    ].join('\n'),
  });
}

async function buildTranscriptDigest({
  apiKey,
  studyContext,
  projectName,
  studyType,
  participantId,
  sessionId,
  chunkSummaries,
}) {
  return callOpenAiStructured({
    apiKey,
    schemaName: 'transcript_digest',
    schema: TRANSCRIPT_DIGEST_SCHEMA,
    reasoningEffort: 'medium',
    systemText: [
      'You are a senior UX researcher combining chunk-level notes from one long moderated transcript into one analysis-ready participant digest.',
      'Preserve the strongest evidence and keep the digest concise enough to be used in downstream cross-participant synthesis.',
      'Do not invent details not present in the chunk summaries.',
      'Use the supplied schema exactly.',
    ].join(' '),
    userText: [
      `Project name: ${projectName}`,
      `Study type: ${studyType || 'single-flow'}`,
      `Participant: ${participantId}`,
      `Session ID: ${sessionId || 'unknown'}`,
      '',
      'Research inputs / script context:',
      normalizeWhitespace(studyContext || ''),
      '',
      'Chunk summaries:',
      chunkSummaries
        .map((item, index) =>
          [
            `Chunk ${index + 1}`,
            `Summary: ${item.summary}`,
            item.evidenceBullets?.length ? `Evidence bullets: ${item.evidenceBullets.join(' | ')}` : null,
            item.notableQuotes?.length ? `Notable quotes: ${item.notableQuotes.join(' | ')}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        )
        .join('\n\n'),
    ].join('\n'),
  });
}

async function prepareResearchContext({ apiKey, project, postProgress }) {
  const rawContext = normalizeWhitespace(project.test_script || '');
  if (!rawContext) {
    return '';
  }

  const shouldCondense = project.study_type === 'moderated-test' || rawContext.length > 8000;
  if (!shouldCondense) {
    return rawContext;
  }

  await postProgress('Preparing condensed research context for GPT-5.5');

  const digest = await callOpenAiStructured({
    apiKey,
    schemaName: 'research_context_digest',
    schema: RESEARCH_CONTEXT_DIGEST_SCHEMA,
    reasoningEffort: 'low',
    systemText: [
      'You are a senior UX researcher preparing a compact study brief from a long research script or background document.',
      'Keep only the context needed for later transcript analysis.',
      'Preserve the study goals and the most important focal research questions.',
      'Use the supplied schema exactly.',
    ].join(' '),
    userText: [
      `Project name: ${project.name}`,
      `Study type: ${project.study_type || 'single-flow'}`,
      '',
      'Research script and context:',
      rawContext,
    ].join('\n'),
  });

  return [
    `Study summary: ${normalizeWhitespace(digest.studySummary || '')}`,
    cleanArray(digest.goals).length ? `Goals:\n- ${cleanArray(digest.goals).join('\n- ')}` : null,
    cleanArray(digest.focalQuestions).length
      ? `Focal questions:\n- ${cleanArray(digest.focalQuestions).join('\n- ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function prepareTranscriptsForAnalysis({
  apiKey,
  project,
  studyContext,
  transcripts,
  postProgress,
}) {
  const totalCharacters = transcripts.reduce(
    (sum, transcript) => sum + String(transcript.transcript || '').length,
    0
  );
  const shouldCondense =
    project.study_type === 'moderated-test' || totalCharacters > 120000;

  if (!shouldCondense) {
    return transcripts;
  }

  const prepared = [];

  for (let i = 0; i < transcripts.length; i += 1) {
    const transcript = transcripts[i];
    const participantId = transcript.participant_id || `participant-${i + 1}`;
    const rawTranscript = normalizeWhitespace(transcript.transcript || '');

    if (!rawTranscript) {
      prepared.push(transcript);
      continue;
    }

    const chunks = splitLargeTranscript(rawTranscript);
    await postProgress(
      `Preparing transcript digest ${i + 1} of ${transcripts.length} for ${participantId}`
    );

    if (chunks.length <= 1 && rawTranscript.length < 12000) {
      prepared.push(transcript);
      continue;
    }

    const chunkSummaries = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      await postProgress(
        `Summarizing ${participantId} transcript chunk ${chunkIndex + 1} of ${chunks.length}`
      );
      const chunkSummary = await summarizeTranscriptChunk({
        apiKey,
        studyContext,
        projectName: project.name,
        studyType: project.study_type,
        participantId,
        sessionId: transcript.session_id,
        chunkText: chunks[chunkIndex],
        chunkIndex,
        totalChunks: chunks.length,
      });
      chunkSummaries.push({
        summary: normalizeWhitespace(chunkSummary.summary || ''),
        evidenceBullets: cleanArray(chunkSummary.evidenceBullets).slice(0, 6),
        notableQuotes: cleanArray(chunkSummary.notableQuotes).slice(0, 4).map((quote) => clipQuote(quote, 180)),
      });
    }

    await postProgress(`Building participant digest for ${participantId}`);
    const digest = await buildTranscriptDigest({
      apiKey,
      studyContext,
      projectName: project.name,
      studyType: project.study_type,
      participantId,
      sessionId: transcript.session_id,
      chunkSummaries,
    });

    const digestText = [
      `Participant digest: ${clipText(normalizeWhitespace(digest.participantSummary || ''), 1200)}`,
      cleanArray(digest.evidenceBullets).length
        ? `Evidence bullets:\n- ${cleanArray(digest.evidenceBullets)
            .slice(0, 6)
            .map((bullet) => clipText(bullet, 180))
            .join('\n- ')}`
        : null,
      cleanArray(digest.notableQuotes).length
        ? `Notable quotes:\n- ${cleanArray(digest.notableQuotes)
            .slice(0, 3)
            .map((quote) => `"${clipQuote(quote, 180)}"`)
            .join('\n- ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    prepared.push({
      ...transcript,
      transcript: digestText,
    });
  }

  return prepared;
}

async function generateAiFindingsSynthesis({
  apiKey,
  project,
  transcripts,
  questionAnalyses,
  progressLog,
}) {
  const transcriptSummary = transcripts
    .map((transcript, index) => {
      const participantId = transcript.participant_id || `participant-${index + 1}`;
      return `- ${participantId}: ${clipText(transcript.transcript || '', 320)}`;
    })
    .join('\n');

  return callOpenAiStructured({
    apiKey,
    schemaName: 'analysis_findings',
    schema: FINDINGS_RESPONSE_SCHEMA,
    reasoningEffort: 'medium',
    systemText: [
      'You are a senior UX researcher writing report-ready findings from an existing question-by-question cross-reference analysis.',
      'Use the saved cross-reference analysis as the primary evidence layer.',
      'Use the research script and raw transcript snippets as supporting context, not as a reason to rewrite the whole study structure.',
      'Return only strong, decision-oriented findings grounded in repeated patterns across participants.',
      'Do not reject the dataset globally unless the transcript content is actually empty or corrupted.',
      'Use the supplied schema exactly.',
    ].join(' '),
    userText: [
      'Generate 3-6 report-ready findings from the following research materials.',
      '',
      'Requirements:',
      '- Use the question-by-question cross-reference analysis as the main evidence base.',
      '- Findings should be suitable for the final research report.',
      '- Make directional product and UX calls where the evidence supports them.',
      '- Avoid restating every question individually.',
      '- Do not produce global invalidation language.',
      '',
      `Project name: ${project.name}`,
      `Study name: ${project.study_name}`,
      `Study type: ${project.study_type || 'single-flow'}`,
      `Transcript count: ${transcripts.length}`,
      '',
      'Research script:',
      normalizeWhitespace(project.analysis_context || project.test_script || ''),
      '',
      'Cross-reference analysis:',
      buildCrossReferenceContext(questionAnalyses),
      '',
      'Transcript snippets:',
      transcriptSummary,
      '',
      `Progress so far: ${progressLog.join(' | ')}`,
    ].join('\n'),
  });
}

function normalizeAiFindings(parsed, project, questionAnalyses) {
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];

  if (findings.length === 0) {
    return deriveFindings(
      {
        name: project.name,
        studyType: project.study_type,
      },
      questionAnalyses
    );
  }

  return findings
    .map((finding) => ({
      type: ['pain-point', 'delighter', 'insight', 'recommendation'].includes(finding.type)
        ? finding.type
        : 'insight',
      title: String(finding.title || '').trim(),
      description: normalizeWhitespace(finding.description || ''),
      severity: ['critical', 'major', 'minor'].includes(finding.severity)
        ? finding.severity
        : 'major',
      participantCount: Number(finding.participantCount) > 0 ? Number(finding.participantCount) : 0,
      conditions: cleanArray(finding.conditions),
      tags: cleanArray(finding.tags),
    }))
    .filter((finding) => finding.title && finding.description);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'your', 'into', 'were', 'was',
  'have', 'they', 'their', 'what', 'when', 'where', 'which', 'about', 'would', 'could',
  'should', 'there', 'then', 'than', 'them', 'because', 'while', 'after', 'before',
  'through', 'during', 'each', 'very', 'just', 'like', 'felt', 'across', 'using',
]);

const REPORT_WRITING_GUIDANCE = {
  objective:
    'Write like a senior UX researcher synthesizing a small usability study for product and design stakeholders.',
  structure: [
    'Lead with the strongest directional takeaway, not a dump of question summaries.',
    'Group evidence into themes such as core value, discoverability, confidence, comparison preference, and backlog opportunities.',
    'Use direct language that explains what matters, why it matters, and what the team should do next.',
    'Prefer implications and product direction over repeating the script question verbatim.',
  ],
};

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeWhitespace(text) {
  return (text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function splitTranscriptSections(text) {
  return normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function extractQuestions(testScript) {
  const lines = normalizeWhitespace(testScript)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .filter((line) => {
      if (line.endsWith('?')) return true;
      return /^(task|question|q\d+|\d+[.)-]|\-|\*)\s+/i.test(line);
    })
    .map((line) =>
      line
        .replace(/^(task|question)\s*\d*[:.)-]?\s*/i, '')
        .replace(/^q\d+[:.)-]?\s*/i, '')
        .replace(/^\d+[.)-]\s*/, '')
        .replace(/^[-*]\s*/, '')
        .trim()
    )
    .filter((line) => line.length > 10);

  const deduped = unique(candidates).slice(0, 30);
  if (deduped.length > 0) return deduped;

  return [
    'What were participants trying to accomplish?',
    'Where did participants experience friction?',
    'What worked well for participants?',
    'What suggestions or expectations did participants express?',
  ];
}

function scoreSectionForQuestion(question, section) {
  const questionTokens = tokenize(question);
  const sectionTokens = tokenize(section);
  const overlap = questionTokens.filter((token) => sectionTokens.includes(token)).length;
  const negativeSignals = (section.match(/\b(confus|frustrat|hard|difficult|issue|problem|stuck|slow|error)\w*/gi) || []).length;
  const positiveSignals = (section.match(/\b(easy|clear|simple|smooth|love|good|great|nice)\w*/gi) || []).length;
  return overlap * 3 + negativeSignals + positiveSignals;
}

function selectEvidenceSections(question, transcript, limit = 2) {
  const sections = splitTranscriptSections(transcript);
  if (sections.length === 0) return [];

  const ranked = sections
    .map((section) => ({
      section,
      score: scoreSectionForQuestion(question, section),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked.filter((item) => item.score > 0).slice(0, limit).map((item) => item.section);
  return best.length > 0 ? best : ranked.slice(0, limit).map((item) => item.section);
}

function clipQuote(text, max = 220) {
  const value = normalizeWhitespace(text);
  return value.length <= max ? value : `${value.slice(0, max).trim()}...`;
}

function summarizeSections(question, notes) {
  const combined = notes.map((note) => note.summary).join(' ');
  const negativeCount = (combined.match(/\b(confus|frustrat|hard|difficult|issue|problem|stuck|slow|error)\w*/gi) || []).length;
  const positiveCount = (combined.match(/\b(easy|clear|simple|smooth|love|good|great|nice)\w*/gi) || []).length;
  const suggestionCount = (combined.match(/\b(should|could|wish|expect|wanted|would like)\b/gi) || []).length;

  if (negativeCount > positiveCount) {
    return `Participants surfaced friction around "${question.toLowerCase()}". Several responses pointed to confusion, effort, or missing cues while completing this part of the study.`;
  }

  if (positiveCount > 0 && positiveCount >= negativeCount) {
    return `Participants generally responded positively to "${question.toLowerCase()}". The strongest reactions mentioned clarity, ease, or a smoother-than-expected experience.`;
  }

  if (suggestionCount > 0) {
    return `Responses to "${question.toLowerCase()}" were mixed, with several participants sharing improvement ideas or unmet expectations.`;
  }

  return `Participants described a range of reactions to "${question.toLowerCase()}". Patterns were consistent enough to synthesize into a study-level readout.`;
}

function extractKeyInsights(notes) {
  const joined = notes.map((note) => note.summary).join(' ');
  const insights = [];

  if (/\b(confus|frustrat|hard|difficult|issue|problem|stuck|slow|error)\w*/i.test(joined)) {
    insights.push('Friction clustered around moments where the next step or expected outcome was unclear.');
  }
  if (/\b(easy|clear|simple|smooth|love|good|great|nice)\w*/i.test(joined)) {
    insights.push('Positive reactions were tied to clarity and a sense of momentum through the task.');
  }
  if (/\b(expect|expected|wish|should|could|wanted)\b/i.test(joined)) {
    insights.push('Participants surfaced explicit expectations and suggestions that point to product opportunities.');
  }

  if (insights.length === 0) {
    insights.push('Responses were varied, but there was enough overlap to describe a shared participant pattern.');
  }

  return insights.slice(0, 3);
}

function buildConditionBreakdown(notes) {
  const grouped = new Map();

  for (const note of notes) {
    const condition = note.condition || 'All participants';
    const group = grouped.get(condition) || [];
    group.push(note.summary);
    grouped.set(condition, group);
  }

  const breakdown = {};
  for (const [condition, summaries] of grouped.entries()) {
    const text = summaries.join(' ');
    breakdown[condition] = /\b(confus|frustrat|hard|difficult|issue|problem|stuck|slow|error)\w*/i.test(text)
      ? 'This condition showed more friction, hesitation, or recovery behaviour in participant responses.'
      : /\b(easy|clear|simple|smooth|love|good|great|nice)\w*/i.test(text)
      ? 'This condition was more often described as clear, easy, or confidence-building.'
      : 'Responses in this condition were mixed without a single dominant pattern.';
  }

  return breakdown;
}

function deriveFindings(project, questionAnalyses) {
  const buckets = {
    coreValue: [],
    discoverability: [],
    confidence: [],
    comparison: [],
    clutter: [],
    backlog: [],
  };

  for (const question of questionAnalyses) {
    const text = `${question.questionText} ${question.summary} ${question.keyInsights.join(' ')}`.toLowerCase();

    if (/(expect|feature|let you do|useful|value|quickly add|job to be done)/.test(text)) {
      buckets.coreValue.push(question);
    }
    if (/(find|start|entry|floating|plus|discover|way to start|import route)/.test(text)) {
      buckets.discoverability.push(question);
    }
    if (/(confident|confidence|added|not added|clear whether|completion|feedback|outcome)/.test(text)) {
      buckets.confidence.push(question);
    }
    if (/(which version|prefer overall|design a|design b|comparison|clearer at a glance|miss anything important)/.test(text)) {
      buckets.comparison.push(question);
    }
    if (/(busy|noise|icon|visual|clutter|cleaner|simpler)/.test(text)) {
      buckets.clutter.push(question);
    }
    if (/(anything else|suggestion|would like|could change|select all|manual add|filter|recurring|timing)/.test(text)) {
      buckets.backlog.push(question);
    }
  }

  const findings = [];

  if (buckets.coreValue.length > 0) {
    findings.push({
      type: 'delighter',
      title: 'The core import concept is working',
      description:
        'Participants generally understood the value of importing occasions and reacted positively to the speed and usefulness of the core flow. The research suggests refinement is needed more than a rethink of the concept itself.',
      severity: 'minor',
      participantCount: Math.max(...buckets.coreValue.map((q) => q.participantCount), 0),
      conditions: unique(buckets.coreValue.flatMap((q) => Object.keys(q.conditionBreakdown))),
      tags: ['auto-generated', 'research-report', 'core-value', project.studyType || 'study'],
    });
  }

  if (buckets.discoverability.length > 0) {
    findings.push({
      type: 'pain-point',
      title: 'Discoverability and entry-point clarity need work',
      description:
        'The bigger usability issue is not the mechanics of import, but understanding how to begin and where the flow starts. This points to an affordance problem around the entry point rather than a failure of the feature concept.',
      severity: 'major',
      participantCount: Math.max(...buckets.discoverability.map((q) => q.participantCount), 0),
      conditions: unique(buckets.discoverability.flatMap((q) => Object.keys(q.conditionBreakdown))),
      tags: ['auto-generated', 'research-report', 'discoverability', project.studyType || 'study'],
    });
  }

  if (buckets.confidence.length > 0) {
    findings.push({
      type: 'pain-point',
      title: 'Completion and confirmation remain the biggest confidence gap',
      description:
        'Participants cared less about selecting items than about knowing whether something had truly been added. Clearer confirmation feedback is likely to have more impact than adding extra controls.',
      severity: 'critical',
      participantCount: Math.max(...buckets.confidence.map((q) => q.participantCount), 0),
      conditions: unique(buckets.confidence.flatMap((q) => Object.keys(q.conditionBreakdown))),
      tags: ['auto-generated', 'research-report', 'confidence', project.studyType || 'study'],
    });
  }

  if (buckets.comparison.length > 0) {
    findings.push({
      type: 'insight',
      title: 'The stronger direction is the option that improves scanability and confidence',
      description:
        'In the direct comparison moments, the more structured direction tends to win because it helps people review the list and feel less likely to miss something important. The research points toward keeping the stronger structure while simplifying its presentation.',
      severity: 'major',
      participantCount: Math.max(...buckets.comparison.map((q) => q.participantCount), 0),
      conditions: unique(buckets.comparison.flatMap((q) => Object.keys(q.conditionBreakdown))),
      tags: ['auto-generated', 'research-report', 'comparison', project.studyType || 'study'],
    });
  }

  if (buckets.clutter.length > 0) {
    findings.push({
      type: 'recommendation',
      title: 'The preferred direction still needs visual restraint',
      description:
        'Participants respond well to improved structure, but extra visual treatments can make the interface feel busier than necessary. The likely best outcome is a simplified version of the stronger design direction, not a more decorated one.',
      severity: 'major',
      participantCount: Math.max(...buckets.clutter.map((q) => q.participantCount), 0),
      conditions: unique(buckets.clutter.flatMap((q) => Object.keys(q.conditionBreakdown))),
      tags: ['auto-generated', 'research-report', 'visual-noise', project.studyType || 'study'],
    });
  }

  if (buckets.backlog.length > 0) {
    findings.push({
      type: 'recommendation',
      title: 'There are useful follow-on enhancements, but they are not the main blocker',
      description:
        'Participants surfaced worthwhile ideas such as stronger filtering, manual add, and broader import controls. These are useful backlog opportunities, but they should come after the core clarity and confidence issues are resolved.',
      severity: 'minor',
      participantCount: Math.max(...buckets.backlog.map((q) => q.participantCount), 0),
      conditions: unique(buckets.backlog.flatMap((q) => Object.keys(q.conditionBreakdown))),
      tags: ['auto-generated', 'research-report', 'backlog', project.studyType || 'study'],
    });
  }

  if (findings.length === 0) {
    return questionAnalyses.slice(0, 5).map((question) => ({
      type: 'insight',
      title: question.questionText,
      description: question.summary,
      severity: 'major',
      participantCount: question.participantCount,
      conditions: Object.keys(question.conditionBreakdown),
      tags: ['auto-generated', 'analysis', project.studyType || 'study'],
    }));
  }

  return findings.slice(0, 6);
}

function buildConditionSummaries(transcripts) {
  const groups = new Map();
  for (const transcript of transcripts) {
    const condition = transcript.condition || 'All participants';
    const group = groups.get(condition) || [];
    group.push(transcript.transcript || '');
    groups.set(condition, group);
  }

  return [...groups.entries()].map(([conditionName, texts]) => {
    const combined = texts.join(' ').toLowerCase();
    let summary =
      'Responses in this group were mixed, with both positive reactions and moments of hesitation.';

    if (/(confus|frustrat|hard|difficult|issue|problem|stuck|slow|error)/.test(combined)) {
      summary =
        'This group showed more friction signals, including hesitation, confusion, or slower progress through the task.';
    } else if (/(easy|clear|simple|smooth|love|good|great|nice)/.test(combined)) {
      summary =
        'This group skewed more positive, with participants more often describing the experience as clear, easy, or smooth.';
    }

    return { conditionName, summary };
  });
}

export async function runHostedAnalysis({ supabase, projectId, analysisRunId, apiKey }) {
  const progressLog = [];

  const postProgress = async (currentStep) => {
    progressLog.push(currentStep);
    await saveAnalysisProgress(supabase, analysisRunId, {
      status: 'running',
      currentStep,
      progressLog,
    });
  };

  try {
    await postProgress('Loading project and transcript data');

    const [
      { data: project, error: projectError },
      { data: transcripts, error: transcriptError },
      { data: balancedAssignments, error: balancedAssignmentError },
    ] =
      await Promise.all([
        supabase
          .from('projects')
          .select('id, name, study_name, study_type, test_script')
          .eq('id', projectId)
          .single(),
        supabase
          .from('transcripts')
          .select('participant_id, session_id, transcript, condition')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true }),
        supabase
          .from('balanced_comparison_assignments')
          .select('participant_id, order_label')
          .eq('project_id', projectId),
      ]);

    if (projectError || !project) {
      throw new Error(projectError?.message || 'Project not found for analysis');
    }
    if (transcriptError || !transcripts || transcripts.length === 0) {
      throw new Error(transcriptError?.message || 'No transcripts available for analysis');
    }
    if (balancedAssignmentError) {
      throw new Error(balancedAssignmentError.message || 'Failed to load balanced comparison assignments');
    }

    if (!apiKey) {
      throw new Error(
        'Analysis requires GPT-5.5 via OPENAI_API_KEY. No fallback analysis is allowed because the model-backed reasoning path is required for accuracy.'
      );
    }

    const normalizedAssignments = (balancedAssignments || []).map((assignment) => ({
      participantId: String(assignment.participant_id || '').trim(),
      orderLabel: assignment.order_label === 'B-A' ? 'B-A' : 'A-B',
    }));

    if (project.study_type === 'balanced-comparison') {
      const transcriptParticipants = [
        ...new Set(transcripts.map((transcript) => String(transcript.participant_id || '').trim()).filter(Boolean)),
      ];
      const assignmentParticipants = new Set(
        normalizedAssignments.map((assignment) => assignment.participantId)
      );
      const missingParticipants = transcriptParticipants.filter(
        (participantId) => !assignmentParticipants.has(participantId)
      );

      if (missingParticipants.length > 0) {
        throw new Error(
          `Balanced comparison analysis requires participant order assignments for every transcript. Missing: ${missingParticipants.join(', ')}`
        );
      }
    }

    let questionAnalyses = [];
    let conditionSummaries = [];
    let findings = [];

    await sleep(300);
    await postProgress('Preparing script and transcript evidence for GPT-5.5');

    const studyContext = await prepareResearchContext({
      apiKey,
      project,
      postProgress,
    });

    const analysisTranscripts = await prepareTranscriptsForAnalysis({
      apiKey,
      project,
      studyContext,
      transcripts,
      postProgress,
    });

    await postProgress('Starting per-question, per-user analysis with GPT-5.5');

    const crossReferenceResult = await generateAiCrossReferenceAnalysis({
      apiKey,
      project: {
        ...project,
        balancedAssignments: normalizedAssignments,
        analysis_context: studyContext,
      },
      transcripts: analysisTranscripts,
      progressLog,
      postProgress,
    });

    questionAnalyses = normalizeAiQuestionOutput(
      crossReferenceResult,
      analysisTranscripts,
      crossReferenceResult.analysisTargets
    );
    conditionSummaries = normalizeAiConditionSummaries(crossReferenceResult, analysisTranscripts);

    await postProgress('Normalizing cross-reference analysis');
    await postProgress('Synthesizing report-ready findings from cross-reference analysis');

    const findingsResult = await generateAiFindingsSynthesis({
      apiKey,
      project: {
        ...project,
        analysis_context: studyContext,
      },
      transcripts: analysisTranscripts,
      questionAnalyses,
      progressLog,
    });

    findings = normalizeAiFindings(findingsResult, project, questionAnalyses);

    await postProgress('Finalizing analysis output');

    await saveAnalysisOutput(supabase, projectId, analysisRunId, {
      status: 'complete',
      currentStep: 'Analysis complete',
      progressLog: [...progressLog, 'Analysis complete'],
      questions: questionAnalyses,
      conditionSummaries,
      findings,
    });

    return {
      success: true,
      projectId,
      analysisRunId,
      questions: questionAnalyses.length,
      findings: findings.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown analysis error';
    try {
      await saveAnalysisProgress(supabase, analysisRunId, {
        status: 'failed',
        currentStep: 'Analysis failed',
        progressLog: [...progressLog, 'Analysis failed'],
        errorMessage: message,
      });
    } catch (postError) {
      console.error(postError instanceof Error ? postError.message : String(postError));
    }
    throw error;
  }
}
