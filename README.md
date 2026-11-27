# TLA+ Workbench

Edit TLA+ specifications and check safety invariants in your browser. The model checker runs locally in a WebAssembly worker. The editor saves your specifications in browser storage.

[Try TLA+ Workbench in your browser](https://snjnlsn.github.io/tla-workbench/). No sign-in is required.

## Run locally

Install [mise](https://mise.jdx.dev/getting-started.html) if needed. Run the following commands once to set up this checkout.

```sh
cd ~/Code/tla-workbench
mise trust
mise install
```

Start the server from the project directory.

```sh
mise run serve
```

Open [the workbench](http://127.0.0.1:8080). In **Seat reservations**, open **HappyPath.tla** and reserve one to three seats. In **SadPath.tla**, reserve four seats to reach a state that violates Safety. Press Ctrl+C in the terminal to stop the server.

## Projects and state exploration

Create a project with the plus button next to **Projects**. Add models with the plus button next to **Models**, or import multiple local files and their matching configurations. Select **Import from GitHub** and paste a public repository URL to create a project from its default branch. The importer reads the top-level **tla/** directory, includes nested folders, and pairs each module with a same-name .cfg in its own folder. Try this repository's URL to import the seat reservation examples. Each model runs independently. Projects and edits are saved in this browser.

**Try a transition** starts at the first initial state. Choose an enabled action, enter proposed next values for the variables it can change, and select **Try transition**. Enter strings as plain text, select TRUE or FALSE for Booleans, and enter whole numbers in the integer fields. The checker validates the entire proposed state and reports whether the invariant holds. Use **Back** to try a different choice.

Switch to **State graph** for the graph preview and the full picker of recorded successors at the selected state. The simulator evaluates actions directly and can explore beyond the model checker's state limit.

## Local settings

Mise loads optional local settings from a file named `.env` in the repository root. Git ignores this file. The app runs with the default settings.

## Build and test

The checkout includes a compiled checker. After you edit the Rust source, run `mise run test` to rebuild the WebAssembly module and test it. To build the module alone, run `mise run build`. Refresh the browser after a build or an edit to the files in `dist/`.

## Supported models

Import a module alone or select its matching .cfg file in the same file picker. Select **Configuration** to edit or download the imported configuration. The configuration reader supports INIT, NEXT, one INVARIANT, and CHECK_DEADLOCK with one directive per line. A configuration without an invariant requests state exploration. Deadlock checking defaults to on for imported configurations. For a module alone, the workbench checks Safety if defined and allows terminal states.

Use one module with integer, string, or Boolean variables, one or more initial states, and named actions. Write a primed choice such as i' \in 0..1000 to enumerate every integer in an inclusive interval. Each combination of independent choices yields one successor. Use assignments, integer ranges, or disjunctions of assignments in Init. Each action must assign each primed variable once. Guards and assignment expressions can read the current state. Use equality, comparisons, addition, subtraction, multiplication, conjunction, disjunction, and parentheses. Use a disjunction of named actions in Next. Write parentheses to group mixed Boolean expressions. Align the bullets of a conjunction or disjunction list. Use parentheses when two inline operators have conflicting precedence.

The checker uses breadth-first search. It reports success only after it explores all reachable states. It reports an incomplete check at the state or time limit. Enable deadlock checking to get a trace to a reachable state with no enabled action. The checker does not evaluate liveness, fairness, sets, quantifiers, constants, or full TLC configuration files. The graph shows up to 12 states at once. Select trace steps to inspect additional states.

## Compare the checker with TLC

The deployed app runs Rust/WebAssembly. Java is used only by the reference tests.
Initialize the pinned upstream fixtures and set TLA_JAR to the official v1.7.4 release JAR (TLC 2.19).
You can set TLA_JAR in the local .env file.

    git submodule update --init tests/parity/upstream
    mise run parity

The suite compares the shipped browser binary with TLC on the precedence regression and example_tla/Test.tla.
It compares named states, initial states, and directed edges. Four upstream assignment models run unchanged on TLC.
Each also has a reduced model whose graph must match the original on both TLC and WebAssembly.
These reductions cover state behavior. The original models also use language features outside the browser subset.

Parser tests use the pinned upstream operator table for every pair of supported infix operators.
They exercise every case in the conjunction, disjunction, and mixed list corpora.
Cases with unsupported constructs require an explicit error. These tests cover parser acceptance and rejection.
They do not compare the full SANY syntax tree.

To test the user workflow, install the development dependencies with npm ci.
Run npx playwright install chromium, then npm run test:browser.
The tests import files, edit and run a specification, change a model configuration, step through enabled transitions,
inspect a counterexample, and reload a saved workspace. GitHub Pages serves only the dist directory.
