# LLM Analysis Specification

This document defines the intended AI analysis architecture for the research workflow.

It exists because the current local analysis flow is a lightweight heuristic synthesizer, while the target product should use GPT-5.5 to perform deeper multi-document research synthesis.

## Purpose

The product should support a real AI-assisted analysis flow across:
- 1 research script
- 5 to 10 participant transcripts
- structured prompts
- staged synthesis

The goal is to generate:
- per-question, per-user analysis
- a final user research report

## Core Requirement

The system must analyze the uploaded research script and all collected transcripts together, using GPT-5.5, rather than relying only on local deterministic logic.

This should feel closer to the manual Codex research workflow:
- read source material
- compare evidence across participants
- synthesize question-level patterns
- write a directional research report

## Inputs

Each project should provide the following analysis inputs:
- Project metadata
- Research script
- Study type
- Participant transcripts
- Participant identifiers or UserTesting usernames

Optional supporting inputs:
- Session identifiers
- Transcript source type, for example `manual` or `playwright`
- Condition or comparison metadata if relevant

## Target Workflow

### Stage 1: Per-Question, Per-User Analysis

Use:
- the research script as the source of truth for the question structure
- all participant transcripts as evidence

For each question in the script, generate:
- a question-level summary
- key insights for that question
- a per-user summary for each participant

Expected output shape:

- Question
- Question summary
- Key insights
- Per-user summaries
  - Participant name
  - Summary
  - Optional supporting quote
  - Optional transcript reference

This stage should be model-backed, not heuristic-only.

### Stage 2: Final Report Generation

Use:
- the original research script
- the full transcript set
- the generated per-question, per-user analysis

Generate a final research report that reads like a UX research synthesis for stakeholders.

The report should not simply restate script questions. It should synthesize patterns into:
- executive summary
- major themes
- implications
- recommendations
- final takeaway
- transcript references

## Recommended Model Usage

### Question-Level Analysis

Recommended model:
- `gpt-5.5`

Recommended reasoning:
- `medium` by default

Use this for:
- per-question, per-user summaries
- question-level key insights
- light evidence synthesis

### Final Report

Recommended model:
- `gpt-5.5`

Recommended reasoning:
- `high`

Use this for:
- executive summary
- theme synthesis
- recommendations
- final report narrative

## Prompting Requirements

The analysis prompts should:
- treat the research script as the source of truth for question structure
- compare all relevant transcript evidence for each question
- produce structured output suitable for storage in Supabase
- avoid inventing participant counts, conditions, or unsupported claims
- ground summaries in actual transcript evidence

The final report prompt should:
- use the full transcript set
- use the per-question, per-user analysis as structured evidence
- use the script to preserve study intent and framing
- generate a polished report for product, design, and research stakeholders

## Why a Two-Stage Architecture Is Preferred

The preferred shape is:

1. Generate per-question, per-user analysis
2. Generate the final report from that analysis plus the original evidence

This is preferred over a single giant synthesis prompt because it:
- mirrors how a UX researcher actually works
- improves traceability
- makes the analysis reviewable before report generation
- gives the report a stronger evidence base
- reduces the risk of vague or generic outputs

## UI Requirements

### Analysis View

The Analysis step or tab should:
- present a question-by-question view
- allow expansion of each question
- show:
  - question summary
  - key insights
  - per-user summaries

The per-user summaries should clearly tie back to the uploaded transcripts.

### Report View

The Report step or tab should:
- display the final AI-generated report
- allow the user to inspect the report prompt
- allow prompt editing
- allow report regeneration
- show transcript references at the bottom

## Data Requirements

The system should store, per project:
- research script
- participant transcripts
- question-level analysis output
- per-user analysis rows
- final report output
- prompt used for report generation
- report versions where applicable

## Non-Goals

This phase does not require:
- export functionality
- hosted Playwright automation
- fully autonomous cloud worker orchestration

Those may come later, but they are not required for the core AI analysis architecture.

## Current Gap

As of this document:
- the report regeneration path can use GPT-5.5 when `OPENAI_API_KEY` is configured
- the main analysis step is still powered by a local heuristic synthesizer

That means the product is not yet fully aligned with this specification.

## Definition of Done

This specification should be considered implemented when:
- the analysis step uses GPT-5.5 rather than only local heuristics
- the app generates real per-question, per-user analysis from all transcripts and the script
- the final report is generated from:
  - the script
  - the raw transcripts
  - the stored per-question, per-user analysis
- the UI makes that workflow understandable and reviewable

