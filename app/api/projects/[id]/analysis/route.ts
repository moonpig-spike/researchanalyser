import { getProjectAnalysis } from '@/lib/queries'
import { createClient } from '@/lib/supabase-client'
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { spawn } from 'node:child_process'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const analysis = await getProjectAnalysis(id)

    if (!analysis) {
      return Response.json(null)
    }

    return Response.json(analysis)
  } catch (error) {
    console.error('API error:', error)
    return Response.json({ error: 'Failed to fetch analysis' }, { status: 500 })
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
            'Analysis requires GPT-5.5 via OPENAI_API_KEY. It cannot be completed right now because the OpenAI API key is not configured for this environment.',
        },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, test_script, study_type')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const { data: transcripts, error: transcriptError } = await supabase
      .from('transcripts')
      .select('participant_id')
      .eq('project_id', projectId)

    if (transcriptError || !transcripts || transcripts.length === 0) {
      return NextResponse.json(
        { error: 'No transcripts available yet. Import transcripts before running analysis.' },
        { status: 400 }
      )
    }

    if (project.study_type === 'balanced-comparison') {
      const transcriptParticipants = [
        ...new Set(
          transcripts
            .map((transcript) => String(transcript.participant_id || '').trim())
            .filter(Boolean)
        ),
      ]

      const { data: assignments, error: assignmentError } = await supabase
        .from('balanced_comparison_assignments')
        .select('participant_id')
        .eq('project_id', projectId)

      if (assignmentError) {
        return NextResponse.json(
          {
            error: 'Failed to load balanced comparison assignments',
            details: assignmentError.message,
          },
          { status: 500 }
        )
      }

      const assignmentParticipants = new Set(
        (assignments || []).map((assignment) => String(assignment.participant_id || '').trim())
      )

      const missingParticipants = transcriptParticipants.filter(
        (participantId) => !assignmentParticipants.has(participantId)
      )

      if (missingParticipants.length > 0) {
        return NextResponse.json(
          {
            error:
              'Balanced comparison analysis cannot run until every transcript participant has an A → B or B → A order assignment.',
            details: `Missing assignments for: ${missingParticipants.join(', ')}`,
          },
          { status: 400 }
        )
      }
    }

    const { data: analysisRun, error: createError } = await supabase
      .from('analysis_runs')
      .insert({
        project_id: projectId,
        status: 'queued',
        model_version: 'gpt-5.5',
        prompt_version: 'ux-researcher-designer-v5',
        current_step: 'Queued',
        progress_log: ['Queued analysis run'],
      })
      .select()
      .single()

    if (createError) {
      return NextResponse.json(
        { error: 'Failed to create analysis run', details: createError.message },
        { status: 500 }
      )
    }

    if (process.env.NODE_ENV !== 'production') {
      const host = request.headers.get('host') || 'localhost:3000'
      const proto =
        host.includes('localhost') || host.startsWith('127.0.0.1')
          ? 'http'
          : request.headers.get('x-forwarded-proto') || 'https'
      const appUrl = `${proto}://${host}`

      const child = spawn(
        'node',
        [
          'scripts/run_local_analysis.js',
          '--project-id',
          projectId,
          '--analysis-run-id',
          analysisRun.id,
          '--app-url',
          appUrl,
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )

      child.stdout?.on('data', (chunk) => {
        console.log(`[analysis:${projectId}] ${chunk.toString().trim()}`)
      })

      child.stderr?.on('data', (chunk) => {
        console.error(`[analysis:${projectId}] ${chunk.toString().trim()}`)
      })

      child.unref()
    }

    return NextResponse.json(
      {
        success: true,
        analysisRunId: analysisRun.id,
        status: 'queued',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Analysis start error:', error)
    return NextResponse.json(
      {
        error: 'Failed to start analysis',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
