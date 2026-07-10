# Engineering Standard

These rules are non-negotiable for every design and code change.

- **Correctness first.** Fully satisfy explicit requirements. Never trade correctness, security, or data integrity for brevity.
- **Understand before editing.** Read relevant code and guidance. Identify root cause, constraints, and conventions; do not guess or patch symptoms.
- **Choose the simplest complete solution.** Compare plausible approaches, then minimize concepts, moving parts, files, dependencies, and behavior changes. Judge the final codebase, not diff size.
- **Build only what is needed now.** No speculative abstractions, future-proofing, generic frameworks, configurability, compatibility layers, fallbacks, or edge-case machinery without a current requirement.
- **Optimize for maintenance.** Prefer obvious, local, idiomatic code with clear names, direct flow, low coupling, and minimal public surface. Clarity beats cleverness and line count. Reuse existing code and standard libraries.
- **Keep scope narrow.** Avoid unrelated refactors. Add helpers, layers, comments, tests, or dependencies only for clear present value.
- **Rethink before finishing.** Ask: “Is this the simplest complete, maintainable design?” If complexity spread, stop and redesign. Remove everything unnecessary.
- **Verify.** Run focused checks for changed behavior and important failure paths. Never weaken tests, types, lint, or safety.
