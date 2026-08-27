import { NextRequest, NextResponse } from 'next/server';
import { CompiledGeneralOpdWorkflow, WorkflowCompiler } from '@/lib/clinical/workflow/compiler';
import { GeneralOpdWorkflowDefinition } from '@/lib/clinical/workflow/definitions/opd';

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      success: true,
      compiledWorkflow: CompiledGeneralOpdWorkflow,
      definition: GeneralOpdWorkflowDefinition,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
