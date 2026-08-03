export type StableTileSnapshotOptions = {
  readSignature: () => string | null;
  wait: (milliseconds: number) => Promise<unknown>;
  requiredChangeFrom?: string | null;
  pollMilliseconds?: number;
  minimumSamples?: number;
  stableSamples?: number;
  maximumSamples?: number;
};

export type StableTileSnapshotResult = {
  signature: string | null;
  samples: number;
  stable: boolean;
};

export async function waitForStableTileSnapshot({
  readSignature,
  wait,
  requiredChangeFrom,
  pollMilliseconds = 50,
  minimumSamples = 6,
  stableSamples = 3,
  maximumSamples = 30,
}: StableTileSnapshotOptions): Promise<StableTileSnapshotResult> {
  let previous: string | null = null;
  let consecutive = 0;
  let changed = requiredChangeFrom === undefined;

  for (let samples = 1; samples <= maximumSamples; samples += 1) {
    const signature = readSignature();
    if (signature !== null && signature !== requiredChangeFrom) changed = true;
    if (signature === null) {
      previous = null;
      consecutive = 0;
    } else if (signature === previous) {
      consecutive += 1;
    } else {
      previous = signature;
      consecutive = 1;
    }

    if (changed && samples >= minimumSamples && consecutive >= stableSamples) {
      return { signature, samples, stable: true };
    }
    if (samples < maximumSamples) await wait(pollMilliseconds);
  }

  return { signature: previous, samples: maximumSamples, stable: false };
}
