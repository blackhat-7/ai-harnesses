# Engineering Principles

These are hard constraints for every code change and patch in this repository.

- **Keep the final code short, simple, readable, and maintainable.** Judge the resulting codebase, not merely the size of the diff.
- **Pause before editing.** Identify the exact root cause and state a concise change plan first.
- **Prefer the smallest complete fix.** Minimize files, lines, concepts, and affected behavior.
- **Keep patches isolated.** Use stable public seams or local adapters; avoid modifying upstream or core code.
- **Do not over-solve.** Avoid speculative hardening, unrelated cleanup, and extra edge-case machinery.
- **Avoid patch-driven version pins.** Do not pin a dependency merely to preserve a patch.
- **Optimize for removal.** Patches must be short, simple, independently testable, and easy to delete.
- **Test the behavior, not implementation details.** Add only focused regression coverage.
- **Redesign when complexity grows.** If a small fix starts spreading, stop and find a narrower boundary.

When trade-offs exist, choose maintainability and minimal coupling over completeness or cleverness.
