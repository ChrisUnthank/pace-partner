# Fix: Session analysis page crashes on load

## What's wrong

The analysis page throws `ReferenceError: Cannot access 'gridMode' before initialization` in the rep split analysis component, which blanks the whole page.

In `src/components/rep-split-analysis-dialog.tsx`, the memo that decides split colours (line ~1373) reads `gridMode`, but the `useState` that creates `gridMode` is declared later, at line ~1418. Because `const` bindings are not hoisted, the component crashes on its first render.

## The fix

Move the `gridMode` state declaration (and its explanatory comment) so it sits above the `splitColors` memo — no logic or behaviour changes, purely reordering two declarations. Hook order stays consistent, so no React warnings.

## Verification

Reload `/app/sessions/:id/analysis` and confirm the page renders and the Pace / Time / HR grid toggle works.
