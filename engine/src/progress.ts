export interface ScanProgressEvent {
  type: "progress";
  phase: string;
  percent: number;
  message: string;
  repoId?: string;
}

export type ScanProgressReporter = (event: ScanProgressEvent) => void;

export function progressEvent(input: Omit<ScanProgressEvent, "type">): ScanProgressEvent {
  return {
    type: "progress",
    phase: input.phase,
    percent: Math.max(0, Math.min(100, Math.round(input.percent))),
    message: input.message,
    ...(input.repoId ? { repoId: input.repoId } : {}),
  };
}
