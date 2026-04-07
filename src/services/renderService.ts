// Moon design rendering is not available on this deployment (requires canvas native bindings).
// Run generateMoonDesign.ts locally to produce designs.

export interface RenderInput {
  moonPhase: string;
  recipientName: string;
  eventDate: Date;
  phraseIntro?: string | null;
  phrase?: string | null;
  fontChoice?: string | null;
}

export async function renderMoonDesign(_input: RenderInput, _outputPath: string): Promise<void> {
  throw new Error("Moon design rendering is not supported on this deployment.");
}
