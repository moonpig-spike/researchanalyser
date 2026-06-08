import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-client'
import {
  getProjectById,
  getProjectAnalysis,
  getProjectFindings,
  getProjectTranscripts,
} from '@/lib/queries'
import { buildResearchReport } from '@/lib/report-builder'

const CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string' },
    citations: {
      type: 'array',
      items: { type: 'string' },
    },
    participantCount: { type: 'number' },
    conditionCoverage: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
    },
  },
  required: ['answer', 'citations', 'participantCount', 'conditionCoverage', 'confidence'],
} as const

function extractJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model output did not contain a JSON object.')
  }

  return JSON.parse(text.slice(start, end + 1))
}

function readStructuredResponseBody(body: any) {
  if (!body || typeof body !== 'object') return null
  if (body.output_parsed && typeof body.output_parsed === 'object') return body.output_parsed
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return extractJsonObject(body.output_text)
  }
  if (!Array.isArray(body.output)) return null

  for (const item of body.output) {
    if (!item || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!content || typeof content !== 'object') continue
      if (content.parsed && typeof content.parsed === 'object') return content.parsed
      if (typeof content.text === 'string' && content.text.trim()) {
        try {
          return extractJsonObject(content.text)
        } catch {
          // Keep searching other blocks.
        }
      }
    }
  }

  return null
}

async function getActiveReport(projectId: string, fallbackReport: ReturnType<typeof buildResearchReport>) {
  const supabase = createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('active_report_version_id')
    .eq('id', projectId)
    .single()

  const activeId = project?.active_report_version_id
  if (!activeId) return fallbackReport

  const { data: version } = await supabase
    .from('report_versions')
    .select('report_json')
    .eq('id', activeId)
    .single()

  if (!version?.report_json || typeof version.report_json !== 'object') {
    return fallbackReport
  }

  return {
    ...fallbackReport,
    ...(version.report_json as Record<string, unknown>),
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            'Project chat requires GPT-5.5 via OPENAI_API_KEY. Chat cannot be completed because the OpenAI API key is not configured for this environment.',
        },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const question = typeof body.question === 'string' ? body.question.trim() : ''

    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    const [project, findings, analysis, transcripts] = await Promise.all([
      getProjectById(projectId),
      getProjectFindings(projectId),
      getProjectAnalysis(projectId),
      getProjectTranscripts(projectId),
    ])

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const fallbackReport = buildResearchReport(project, findings, analysis)
    const report = await getActiveReport(projectId, fallbackReport)

    const transcriptContext = transcripts
      .map((transcript) =>
        [
          `Participant: ${transcript.participantId}`,
          `Session ID: ${transcript.sessionId}`,
          `Condition: ${transcript.condition || 'All participants'}`,
          'Transcript:',
          transcript.transcript,
        ].join('\n')
      )
      .join('\n\n---\n\n')

    const analysisContext = (analysis?.questions || [])
      .map((item) =>
        [
          `${item.questionNumber}: ${item.question}`,
          `Summary: ${item.summary}`,
          item.keyInsights.length > 0 ? `Key insights: ${item.keyInsights.join(' | ')}` : null,
          item.citations.length > 0
            ? `Per-user evidence:\n${item.citations
                .map(
                  (citation) =>
                    `- ${citation.participantId}: ${citation.summary || citation.quote || 'No summary'}${citation.transcriptReference ? ` [${citation.transcriptReference}]` : ''}`
                )
                .join('\n')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n')

    const reportContext = [
      `Study objective: ${report.studyObjective}`,
      `Caveat: ${report.caveat}`,
      `Executive summary: ${report.executiveSummary.join(' ')}`,
      `Themes:\n${report.researchThemes
        .map((theme) => `- ${theme.title}: ${theme.body} Implication: ${theme.implication}`)
        .join('\n')}`,
      `Recommendations: ${report.recommendations.join(' | ')}`,
      `Final takeaway: ${report.finalTakeaway}`,
    ].join('\n\n')

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        reasoning: { effort: 'medium' },
        text: {
          format: {
            type: 'json_schema',
            name: 'project_chat_answer',
            strict: true,
            schema: CHAT_RESPONSE_SCHEMA,
          },
        },
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'You are a UX research assistant for a single project.',
                  'Answer only using the supplied study materials: the research script, the raw transcripts, the question-by-question analysis, and the final report.',
                  'Do not use outside knowledge.',
                  'Do not infer unsupported facts.',
                  'If the source material does not support a confident answer, say so clearly.',
                  'Keep answers useful, evidence-based, and specific.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  `Project: ${project.name}`,
                  `Study type: ${project.studyType}`,
                  `Transcript count: ${project.transcriptCount}`,
                  '',
                  'Guardrails:',
                  '- Use only the supplied study materials.',
                  '- Prefer transcript and analysis evidence over generalization.',
                  '- Cite sources by participant or file reference where possible.',
                  '- If the answer is not supported by the material, say that directly.',
                  '',
                  'Research script:',
                  project.testScript || 'No script available.',
                  '',
                  'Question-by-question analysis:',
                  analysisContext || 'No analysis available.',
                  '',
                  'Final report:',
                  reportContext,
                  '',
                  'Raw transcripts:',
                  transcriptContext || 'No transcripts available.',
                  '',
                  `User question: ${question}`,
                ].join('\n'),
              },
            ],
          },
        ],
      }),
    })

    const responseBody = await response.json().catch(() => ({}))
    if (!response.ok) {
      return NextResponse.json(
        { error: responseBody.error?.message || 'OpenAI chat generation failed' },
        { status: 500 }
      )
    }

    const refusal = Array.isArray(responseBody.output)
      ? responseBody.output
          .flatMap((item: any) => (Array.isArray(item.content) ? item.content : []))
          .find((item: any) => item?.type === 'refusal')
      : null

    if (refusal?.refusal) {
      return NextResponse.json(
        { error: `Model refused project chat response: ${refusal.refusal}` },
        { status: 400 }
      )
    }

    const parsed = readStructuredResponseBody(responseBody)
    if (!parsed) {
      return NextResponse.json(
        { error: 'Model did not return a structured project chat response.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      answer: String(parsed.answer || '').trim(),
      citations: Array.isArray(parsed.citations)
        ? parsed.citations.map((item: unknown) => String(item).trim()).filter(Boolean)
        : [],
      participantCount: Number(parsed.participantCount) || project.participantCount,
      conditionCoverage: Array.isArray(parsed.conditionCoverage)
        ? parsed.conditionCoverage.map((item: unknown) => String(item).trim()).filter(Boolean)
        : [],
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium',
    })
  } catch (error) {
    console.error('Project chat error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate chat response',
      },
      { status: 500 }
    )
  }
}
