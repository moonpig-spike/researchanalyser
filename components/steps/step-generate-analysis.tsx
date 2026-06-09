'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Loader2,
  CheckCircle2,
  FileText,
  FileOutput,
  Sparkles,
  Users,
} from 'lucide-react'
import type { AnalysisRun } from '@/lib/queries'

interface StepGenerateAnalysisProps {
  projectId?: string
  studyType?: 'single-flow' | 'balanced-comparison' | 'moderated-test'
}

export function StepGenerateAnalysis({
  projectId,
  studyType = 'single-flow',
}: StepGenerateAnalysisProps) {
  const router = useRouter()
  const [analysis, setAnalysis] = useState<AnalysisRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const fetchAnalysis = async () => {
    if (!projectId) return
    try {
      const response = await fetch(`/api/projects/${projectId}/analysis`)
      if (!response.ok) throw new Error('Failed to fetch analysis status')
      const data = await response.json()
      setAnalysis(data)
    } catch (error) {
      console.error('Failed to fetch analysis:', error)
    }
  }

  useEffect(() => {
    if (!projectId) return
    fetchAnalysis()
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    if (!analysis || (analysis.status !== 'queued' && analysis.status !== 'running')) return

    const timer = setInterval(() => {
      fetchAnalysis().catch((error) => {
        console.error('Failed to refresh analysis status:', error)
      })
    }, 3000)

    return () => clearInterval(timer)
  }, [projectId, analysis?.status])

  const handleRunAnalysis = async () => {
    if (!projectId) {
      setRunError('Project must be created before analysis can run.')
      return
    }

    setLoading(true)
    setRunError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/analysis`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        const message = [error.error, error.details].filter(Boolean).join(': ')
        throw new Error(message || 'Failed to start analysis')
      }

      await fetchAnalysis()
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Failed to start analysis')
    } finally {
      setLoading(false)
    }
  }

  const isRunning = analysis?.status === 'queued' || analysis?.status === 'running'
  const isModerated = studyType === 'moderated-test'
  const progress = useMemo(() => {
    if (!analysis) return 0
    if (analysis.status === 'queued') return 10
    if (analysis.status === 'complete') return 100
    if (analysis.status === 'failed') return 0
    const completedSteps = analysis.progressLog?.length || 0
    return Math.min(90, 15 + completedSteps * 10)
  }, [analysis])

  const outputs = [
    {
      id: 'questions',
      name: isModerated ? 'Research analysis' : 'Per-question, per-user analysis',
      status:
        analysis?.status === 'complete'
          ? 'complete'
          : isRunning
          ? 'running'
          : 'pending',
      icon: <FileText className="h-4 w-4" />,
    },
    {
      id: 'report',
      name: 'Final research report',
      status:
        analysis?.status === 'complete'
          ? 'complete'
          : analysis?.currentStep?.toLowerCase().includes('report')
          ? 'running'
          : isRunning
          ? 'running'
          : 'pending',
      icon: <FileOutput className="h-4 w-4" />,
    },
  ] as const

  const handleViewOutput = (outputId: 'questions' | 'report') => {
    if (!projectId) return
    const tab = outputId === 'questions' ? 'analysis' : 'report'
    router.push(`/projects/${projectId}?tab=${tab}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {isModerated ? 'Generate Research Analysis' : 'Generate Analysis'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isModerated
            ? 'Use the saved research inputs and all collected transcripts to create a grounded research analysis and final report.'
            : 'Use the saved research script and all collected transcripts to create the question-by-question analysis and final research report.'}
        </p>
      </div>

      <Card className="p-5 border-border bg-card">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">How analysis works</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {isModerated
                ? 'The research inputs act as grounding context. We first build a transcript-grounded research analysis, then use that analysis with the transcripts to synthesize findings for the final report.'
                : 'The script acts as the source of truth for the questions. We first build a per-question, per-user cross-reference analysis, then use that structured analysis with the transcripts to synthesize findings for the final report.'}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <FileText className="h-4 w-4 text-primary mb-2" />
              <p className="text-sm font-medium text-foreground">
                {isModerated ? 'Grounding materials' : 'Script-led questions'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isModerated
                  ? 'We ground the analysis in the uploaded guide, objectives, and research context.'
                  : 'We derive the analysis structure from the uploaded user research script.'}
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <Users className="h-4 w-4 text-primary mb-2" />
              <p className="text-sm font-medium text-foreground">
                {isModerated ? 'Research synthesis' : 'Per-user summaries'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isModerated
                  ? 'Participant evidence is synthesized into a theme-led research analysis before any higher-level report drafting happens.'
                  : 'Every participant is summarized against every relevant question before any higher-level synthesis happens.'}
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <FileOutput className="h-4 w-4 text-primary mb-2" />
              <p className="text-sm font-medium text-foreground">Final report</p>
              <p className="text-xs text-muted-foreground mt-1">
                {isModerated
                  ? 'The final report synthesizes the research inputs, transcripts, and research analysis.'
                  : 'The final report synthesizes the script, transcripts, and per-question analysis.'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 border-border bg-card">
        <div className="flex items-center justify-between mb-4 gap-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">Run analysis</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isModerated
                ? 'Generate the structured research analysis and final research report'
                : 'Generate the structured analysis and final research report'}
            </p>
          </div>
          <Button
            onClick={handleRunAnalysis}
            disabled={isRunning || loading || !projectId}
            className="gap-2"
          >
            {isRunning || loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Analysis
              </>
            )}
          </Button>
        </div>

        {runError && <p className="text-sm text-destructive mb-4">{runError}</p>}

        {(analysis || progress > 0) && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="text-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {analysis?.currentStep && (
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-sm font-medium text-foreground">{analysis.currentStep}</p>
                {analysis.errorMessage && (
                  <p className="text-xs text-destructive mt-1">{analysis.errorMessage}</p>
                )}
              </div>
            )}

            {(analysis?.progressLog?.length || 0) > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Activity
                </p>
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
                  {analysis?.progressLog?.slice(-6).map((entry, index) => (
                    <p key={`${entry}-${index}`} className="text-xs text-muted-foreground">
                      {entry}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2">
              {outputs.map((output) => (
                <div
                  key={output.id}
                  className={cn(
                    'flex items-center gap-3 rounded-md p-3 transition-colors',
                    output.status === 'complete'
                      ? 'bg-success/10'
                      : output.status === 'running'
                      ? 'bg-primary/10'
                      : 'bg-muted/30'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md',
                      output.status === 'complete'
                        ? 'bg-success/20 text-success'
                        : output.status === 'running'
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {output.status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : output.status === 'complete' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      output.icon
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{output.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {output.status === 'complete'
                        ? 'Generated successfully'
                        : output.status === 'running'
                        ? 'Processing...'
                        : 'Waiting...'}
                    </p>
                  </div>
                  {output.status === 'complete' && (
                    <Button variant="ghost" size="sm" onClick={() => handleViewOutput(output.id)}>
                      View
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 border-border bg-muted/30">
        <div className="flex items-start gap-3 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong className="text-foreground">Model:</strong> {analysis?.modelVersion || 'gpt-5.5'}
            </p>
            <p className="mt-1">
              <strong className="text-foreground">Prompt Version:</strong> {analysis?.promptVersion || 'ux-researcher-designer-v1'}
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
