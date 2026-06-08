import { createClient } from '@/lib/supabase-client'
import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HOSTED_CAPTURE_UNAVAILABLE =
  'Hosted Sites cannot launch the local Playwright/UserTesting capture helper. Use manual transcript entry in the hosted app, or run the local helper from this repo: npm run import-usertesting -- --project-id <project-id> --app-url https://researchanalyser.moonpig.chatgpt-team.site'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  if (!projectId) {
    return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
  }

  try {
    const supabase = createClient()

    // Get project to verify it exists and has usertesting_url
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, usertesting_url')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Validate usertesting_url
    if (!project.usertesting_url) {
      return NextResponse.json(
        { error: 'UserTesting URL not configured for this project' },
        { status: 400 }
      )
    }

    if (!project.usertesting_url.endsWith('/sessions')) {
      return NextResponse.json(
        { error: 'Invalid UserTesting URL - must end with /sessions' },
        { status: 400 }
      )
    }

    // Create import run record with status='queued'
    const { data: importRun, error: createError } = await supabase
      .from('import_runs')
      .insert({
        project_id: projectId,
        status: process.env.NODE_ENV === 'production' ? 'failed' : 'queued',
        sessions_url: project.usertesting_url,
        current_step:
          process.env.NODE_ENV === 'production'
            ? 'Hosted capture helper unavailable'
            : null,
        progress_log:
          process.env.NODE_ENV === 'production'
            ? ['Hosted capture helper unavailable']
            : [],
        error_message:
          process.env.NODE_ENV === 'production' ? HOSTED_CAPTURE_UNAVAILABLE : null,
        completed_at: process.env.NODE_ENV === 'production' ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (createError) {
      return NextResponse.json(
        { error: 'Failed to create import run', details: createError.message },
        { status: 500 }
      )
    }

    // In local/dev usage, automatically kick off the bridge script so the app
    // does not sit in "queued" forever waiting for a separate manual command.
    if (process.env.NODE_ENV !== 'production') {
      const host = request.headers.get('host') || 'localhost:3000'
      const proto = host.includes('localhost') || host.startsWith('127.0.0.1')
        ? 'http'
        : request.headers.get('x-forwarded-proto') || 'https'
      const appUrl = `${proto}://${host}`
      const repoRoot = process.cwd()
      const outputDir = path.join('Bulk import', projectId)

      const child = spawn(
        'node',
        [
          'scripts/import_usertesting_results.js',
          '--project-id',
          projectId,
          '--out',
          outputDir,
          '--app-url',
          appUrl,
        ],
        {
          cwd: repoRoot,
          env: process.env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )

      child.stdout?.on('data', (chunk) => {
        console.log(`[import:${projectId}] ${chunk.toString().trim()}`)
      })

      child.stderr?.on('data', (chunk) => {
        console.error(`[import:${projectId}] ${chunk.toString().trim()}`)
      })

      child.unref()
    } else {
      return NextResponse.json(
        {
          error: HOSTED_CAPTURE_UNAVAILABLE,
          importRunId: importRun.id,
          status: 'failed',
        },
        { status: 501 }
      )
    }

    // Return success immediately - local dev auto-spawns the bridge script and
    // production can still rely on an external worker.
    return NextResponse.json(
      {
        success: true,
        importRunId: importRun.id,
        status: 'queued',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Failed to start transcript import', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  if (!projectId) {
    return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
  }

  try {
    const supabase = createClient()

    const { data: latestRun, error: runError } = await supabase
      .from('import_runs')
      .select('id, status')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (runError || !latestRun) {
      return NextResponse.json(
        { error: 'No queued or running import to cancel' },
        { status: 404 }
      )
    }

    const { error: updateError } = await supabase
      .from('import_runs')
      .update({
        status: 'failed',
        error_message: 'Cancelled by user',
        completed_at: new Date().toISOString(),
      })
      .eq('id', latestRun.id)

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to cancel import', details: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, cancelled: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to cancel import', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  if (!projectId) {
    return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
  }

  try {
    const supabase = createClient()

    // Get latest import run
    const { data: latestRun, error: runError } = await supabase
      .from('import_runs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Get transcript count
    const { count: transcriptCount } = await supabase
      .from('transcripts')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)

    // Get session count
    const { count: sessionCount } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)

    const importRun =
      process.env.NODE_ENV === 'production' &&
      latestRun &&
      (latestRun.status === 'queued' || latestRun.status === 'running') &&
      !latestRun.error_message
        ? {
            ...latestRun,
            status: 'failed',
            current_step: 'Hosted capture helper unavailable',
            progress_log: [
              ...((latestRun.progress_log as string[] | null) || []),
              'Hosted capture helper unavailable',
            ],
            error_message: HOSTED_CAPTURE_UNAVAILABLE,
          }
        : latestRun || null

    return NextResponse.json({
      importRun,
      discoveredSessions: sessionCount || 0,
      importedTranscripts: transcriptCount || 0,
    })
  } catch (error) {
    console.error('Error fetching import status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch import status' },
      { status: 500 }
    )
  }
}
