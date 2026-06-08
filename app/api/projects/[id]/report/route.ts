import { getProjectById, getProjectFindings, getProjectAnalysis } from '@/lib/queries'
import type { Finding } from '@/lib/queries'
import type { Project } from '@/lib/types'
import type { AnalysisRun } from '@/lib/queries'
import type { ReportSectionEvidence, ResearchReportData, ResearchTheme } from '@/lib/report-builder'
import { buildResearchReport } from '@/lib/report-builder'
import { createClient } from '@/lib/supabase-client'

interface ReportGenerationMetadata {
  mode: 'deterministic' | 'ai'
  model?: string
  warning?: string
}

interface PersistedReportVersion {
  id: string
  createdAt: string
  generationMode: 'deterministic' | 'ai'
  model?: string
  prompt: string
  report: ResearchReportData
}

async function loadReportContext(id: string) {
  const [project, findings, analysis] = await Promise.all([
    getProjectById(id),
    getProjectFindings(id),
    getProjectAnalysis(id),
  ])

  return { project, findings, analysis }
}

async function getActiveReportVersionId(projectId: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('active_report_version_id')
    .eq('id', projectId)
    .single()

  if (error || !data) {
    return undefined
  }

  return data.active_report_version_id || undefined
}

function isResearchThemeArray(value: unknown): value is ResearchTheme[] {
  return Array.isArray(value)
}

function sanitizeEvidence(value: unknown, fallback: ReportSectionEvidence): ReportSectionEvidence {
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const record = value as Record<string, unknown>

  return {
    evidenceSummary:
      typeof record.evidenceSummary === 'string' ? record.evidenceSummary : fallback.evidenceSummary,
    sourceQuestionIds: sanitizeStringArray(record.sourceQuestionIds, fallback.sourceQuestionIds),
    sourceQuestionLabels: sanitizeStringArray(record.sourceQuestionLabels, fallback.sourceQuestionLabels),
    sourceParticipantIds: sanitizeStringArray(record.sourceParticipantIds, fallback.sourceParticipantIds),
    sourceParticipantLabels: sanitizeStringArray(record.sourceParticipantLabels, fallback.sourceParticipantLabels),
    sourceTranscriptIds: sanitizeStringArray(record.sourceTranscriptIds, fallback.sourceTranscriptIds),
    sourceTranscriptRefs: sanitizeStringArray(record.sourceTranscriptRefs, fallback.sourceTranscriptRefs),
    limitedSupport:
      typeof record.limitedSupport === 'boolean' ? record.limitedSupport : fallback.limitedSupport,
  }
}

function normalizeStoredReport(value: unknown, fallback: ResearchReportData): ResearchReportData {
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const record = value as Record<string, unknown>

  return {
    ...fallback,
    studyObjective: typeof record.studyObjective === 'string' ? record.studyObjective : fallback.studyObjective,
    caveat: typeof record.caveat === 'string' ? record.caveat : fallback.caveat,
    executiveSummary: sanitizeStringArray(record.executiveSummary, fallback.executiveSummary),
    executiveSummaryEvidence: sanitizeEvidence(record.executiveSummaryEvidence, fallback.executiveSummaryEvidence),
    researchThemes: isResearchThemeArray(record.researchThemes) ? sanitizeThemes(record.researchThemes, fallback.researchThemes) : fallback.researchThemes,
    keyNeeds: sanitizeStringArray(record.keyNeeds, fallback.keyNeeds),
    keyNeedsEvidence: Array.isArray(record.keyNeedsEvidence)
      ? record.keyNeedsEvidence.map((item, index) => sanitizeEvidence(item, fallback.keyNeedsEvidence[index] || fallback.executiveSummaryEvidence))
      : fallback.keyNeedsEvidence,
    recommendations: sanitizeStringArray(record.recommendations, fallback.recommendations),
    recommendationsEvidence: Array.isArray(record.recommendationsEvidence)
      ? record.recommendationsEvidence.map((item, index) => sanitizeEvidence(item, fallback.recommendationsEvidence[index] || fallback.executiveSummaryEvidence))
      : fallback.recommendationsEvidence,
    suggestedDirection: sanitizeStringArray(record.suggestedDirection, fallback.suggestedDirection),
    suggestedDirectionEvidence: Array.isArray(record.suggestedDirectionEvidence)
      ? record.suggestedDirectionEvidence.map((item, index) => sanitizeEvidence(item, fallback.suggestedDirectionEvidence[index] || fallback.executiveSummaryEvidence))
      : fallback.suggestedDirectionEvidence,
    finalTakeaway: typeof record.finalTakeaway === 'string' ? record.finalTakeaway : fallback.finalTakeaway,
    finalTakeawayEvidence: sanitizeEvidence(record.finalTakeawayEvidence, fallback.finalTakeawayEvidence),
    researchInputs: sanitizeStringArray(record.researchInputs, fallback.researchInputs),
    reportPrompt: typeof record.reportPrompt === 'string' ? record.reportPrompt : fallback.reportPrompt,
    transcriptReferences: Array.isArray(record.transcriptReferences)
      ? record.transcriptReferences
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const entry = item as Record<string, unknown>
            const participantId = typeof entry.participantId === 'string' ? entry.participantId : ''
            const transcriptReference = typeof entry.transcriptReference === 'string' ? entry.transcriptReference : ''
            const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : undefined
            if (!participantId || !transcriptReference) return null
            return { participantId, transcriptReference, sessionId }
          })
          .filter(Boolean) as ResearchReportData['transcriptReferences']
      : fallback.transcriptReferences,
    priorityGroups: fallback.priorityGroups,
  }
}

async function fetchReportVersions(projectId: string, fallback: ResearchReportData): Promise<PersistedReportVersion[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_versions')
    .select('id, created_at, generation_mode, model, prompt, report_json')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error || !data) {
    return []
  }

  return data.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    generationMode: row.generation_mode || 'deterministic',
    model: row.model || undefined,
    prompt: row.prompt || fallback.reportPrompt,
    report: normalizeStoredReport(row.report_json, fallback),
  }))
}

async function saveReportVersion(
  projectId: string,
  analysisRunId: string | undefined,
  report: ResearchReportData,
  metadata: ReportGenerationMetadata
) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_versions')
    .insert({
      project_id: projectId,
      analysis_run_id: analysisRunId || null,
      generation_mode: metadata.mode,
      model: metadata.model || null,
      prompt: report.reportPrompt,
      report_json: report,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { error: error || null, versionId: undefined as string | undefined }
  }

  return { error: null, versionId: data.id as string }
}

async function setActiveReportVersion(projectId: string, versionId: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('projects')
    .update({ active_report_version_id: versionId })
    .eq('id', projectId)

  return error || null
}

function sanitizeStringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback
}

function sanitizeThemes(value: unknown, fallback: ResearchTheme[]) {
  if (!Array.isArray(value)) return fallback

  const themes = value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const title = String(record.title || '').trim()
      const body = String(record.body || '').trim()
      const implication = String(record.implication || '').trim()

      if (!title || !body || !implication) return null

      return {
        id: `ai-theme-${index + 1}`,
        title,
        body,
        implication,
        evidence: sanitizeEvidence(record.evidence, fallback[index]?.evidence || fallback[0]?.evidence || {
          evidenceSummary: 'Supporting analysis is limited for this section.',
          sourceQuestionIds: [],
          sourceQuestionLabels: [],
          sourceParticipantIds: [],
          sourceParticipantLabels: [],
          sourceTranscriptIds: [],
          sourceTranscriptRefs: [],
          limitedSupport: true,
        }),
      }
    })
    .filter(Boolean) as ResearchTheme[]

  return themes.length > 0 ? themes : fallback
}

function extractJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output did not contain a JSON object.')
  }

  return JSON.parse(text.slice(start, end + 1))
}

async function generateAiReport(
  project: Project,
  findings: Finding[],
  analysis: AnalysisRun | null,
  baseReport: ResearchReportData,
  prompt: string
): Promise<{ report: ResearchReportData; metadata: ReportGenerationMetadata }> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return {
      report: {
        ...baseReport,
        reportPrompt: prompt,
      },
      metadata: {
        mode: 'deterministic',
        warning: 'OPENAI_API_KEY is not configured, so the report shown is the deterministic fallback rather than an AI-regenerated draft.',
      },
    }
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.5',
      reasoning: { effort: 'high' },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You write strong, decision-oriented UX research reports. Return valid JSON only.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${prompt}

Return JSON only in this exact shape:
{
  "studyObjective": "string",
  "caveat": "string",
  "executiveSummary": ["string"],
  "researchThemes": [
    { "title": "string", "body": "string", "implication": "string" }
  ],
  "keyNeeds": ["string"],
  "recommendations": ["string"],
  "suggestedDirection": ["string"],
  "finalTakeaway": "string"
}

Project context:
- Project name: ${project.name}
- Study name: ${project.studyName}
- Transcript count: ${project.transcriptCount}
- Findings count: ${findings.length}
- Analysis questions: ${analysis?.questions.length || 0}

Use the supplied evidence. Do not invent participant counts, conditions, or references.`,
            },
          ],
        },
      ],
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error?.message || 'OpenAI report generation failed')
  }

  const outputText = typeof body.output_text === 'string' ? body.output_text : ''
  const parsed = extractJsonObject(outputText)

  return {
    report: {
      ...baseReport,
      studyObjective: String(parsed.studyObjective || baseReport.studyObjective),
      caveat: String(parsed.caveat || baseReport.caveat),
      executiveSummary: sanitizeStringArray(parsed.executiveSummary, baseReport.executiveSummary),
      researchThemes: sanitizeThemes(parsed.researchThemes, baseReport.researchThemes),
      keyNeeds: sanitizeStringArray(parsed.keyNeeds, baseReport.keyNeeds),
      recommendations: sanitizeStringArray(parsed.recommendations, baseReport.recommendations),
      suggestedDirection: sanitizeStringArray(parsed.suggestedDirection, baseReport.suggestedDirection),
      finalTakeaway: String(parsed.finalTakeaway || baseReport.finalTakeaway),
      reportPrompt: prompt,
    },
    metadata: {
      mode: 'ai',
      model: 'gpt-5.5',
    },
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { project, findings, analysis } = await loadReportContext(id)

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }

    const baseReport = buildResearchReport(project, findings, analysis)
    const versions = await fetchReportVersions(project.id, baseReport)
    const activeReportVersionId = await getActiveReportVersionId(project.id)
    const activeVersion = versions.find((version) => version.id === activeReportVersionId)
    const latestVersion = versions[0]
    const selectedVersion = activeVersion || latestVersion
    const report = selectedVersion?.report || baseReport

    return Response.json({
      project,
      findings,
      analysis,
      report,
      reportVersions: versions,
      activeReportVersionId: selectedVersion?.id || null,
      generation: {
        mode: selectedVersion?.generationMode || 'deterministic',
        model: selectedVersion?.model,
      },
    })
  } catch (error) {
    console.error('Error fetching report data:', error)
    return Response.json({ error: 'Failed to fetch report data' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { project, findings, analysis } = await loadReportContext(id)

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }

    const baseReport = buildResearchReport(project, findings, analysis)
    const body = await request.json().catch(() => ({}))
    const prompt =
      typeof body.prompt === 'string' && body.prompt.trim().length > 0
        ? body.prompt.trim()
        : baseReport.reportPrompt

    const { report, metadata } = await generateAiReport(project, findings, analysis, baseReport, prompt)
    const saveResult = await saveReportVersion(project.id, analysis?.id, report, metadata)
    let activeVersionWarning: string | undefined
    if (saveResult.versionId) {
      const activeError = await setActiveReportVersion(project.id, saveResult.versionId)
      if (activeError) {
        activeVersionWarning = activeError.message.includes('active_report_version_id')
          ? 'The regenerated report was saved, but this Supabase project is missing the active_report_version_id column so the draft could not be marked as active.'
          : activeError.message
      }
    }
    const versions = await fetchReportVersions(project.id, report)

    const generation: ReportGenerationMetadata = saveResult.error || activeVersionWarning
      ? {
          ...metadata,
          warning: saveResult.error
            ? saveResult.error.message.includes('report_versions')
              ? 'The regenerated report worked, but this Supabase project is missing the report_versions table so the draft was not saved.'
              : saveResult.error.message
            : activeVersionWarning,
        }
      : metadata

    return Response.json({
      project,
      findings,
      analysis,
      report,
      reportVersions: versions,
      activeReportVersionId: saveResult.versionId || null,
      generation,
    })
  } catch (error) {
    console.error('Error regenerating report data:', error)
    return Response.json(
      {
        error: 'Failed to regenerate report',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const versionId = typeof body.versionId === 'string' ? body.versionId : ''

    if (!versionId) {
      return Response.json({ error: 'versionId is required' }, { status: 400 })
    }

    const activeError = await setActiveReportVersion(id, versionId)
    if (activeError) {
      return Response.json(
        {
          error: 'Failed to set active report version',
          details: activeError.message,
        },
        { status: 500 }
      )
    }

    return Response.json({ success: true, activeReportVersionId: versionId })
  } catch (error) {
    return Response.json(
      {
        error: 'Failed to update active report version',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
