# Phase 2 Evaluation Set

The phase 2 dataset is manifest-driven so real sensitive images do not enter Git.

- Metadata lives in `fixtures/phase-2-evaluation-manifest.json`.
- Real images should live locally under `private-fixtures/phase-2/`.
- `private-fixtures/` is ignored by Git.
- The target set has 50 examples: 10 IDs/cards, 10 medical labels, 10 address/mail docs, 10 screen examples, and 10 public-safe items.

Each manifest item records filename, group, expected severity, expected category, source type, and notes. Use the exported scan history feedback fields to compare predictions against this manifest during prompt tuning.
