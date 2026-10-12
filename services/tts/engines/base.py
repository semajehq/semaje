"""Engine contract: text chunks in, mono float32 audio out."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Audio:
    samples: object      # numpy float32 array in [-1, 1]
    sample_rate: int

    @property
    def duration(self) -> float:
        return round(len(self.samples) / self.sample_rate, 3) if self.sample_rate else 0.0


class Synth:
    engine = "base"

    def load(self) -> None:
        raise NotImplementedError

    def synthesize(self, chunks: list[str], speed: float = 1.0, speaker: int | None = None) -> Audio:
        raise NotImplementedError


def join(parts: list, sample_rate: int, gap_sec: float = 0.25):
    """Concatenate chunk audio with a short pause between sentences groups."""
    import numpy as np

    if not parts:
        return np.zeros(0, dtype=np.float32)
    gap = np.zeros(int(sample_rate * gap_sec), dtype=np.float32)
    out = []
    for i, part in enumerate(parts):
        if i:
            out.append(gap)
        out.append(np.asarray(part, dtype=np.float32))
    return np.concatenate(out)
