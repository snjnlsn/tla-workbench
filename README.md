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

Open [the workbench](http://127.0.0.1:8080). Select **Counter.tla** to explore five reachable states. Select **Overflow.tla** to inspect a failing invariant. Select a graph node or trace step to see its variable values. Press Ctrl+C in the terminal to stop the server.

## Local settings

Mise loads optional local settings from a file named `.env` in the repository root. Git ignores this file. The app runs with the default settings.

## Build and test

The checkout includes a compiled checker. After you edit the Rust source, run `mise run test` to rebuild the WebAssembly module and test it. To build the module alone, run `mise run build`. Refresh the browser after a build or an edit to the files in `dist/`.

## Supported models

Import a module alone or select its matching .cfg file in the same file picker. The configuration reader supports INIT, NEXT, one INVARIANT, and CHECK_DEADLOCK with one directive per line. A configuration without an invariant requests state exploration. Deadlock checking defaults to on for imported configurations. For a module alone, the workbench checks Safety if defined and allows terminal states.

Use one module with integer, string, or Boolean variables, a single initial state, and named actions. Write a primed choice such as i' \in 0..1000 to enumerate every integer in an inclusive interval. Each combination of independent choices yields one successor. Write Init as a conjunction of assignments with constant expressions. Each action must assign each primed variable once. Guards and assignment expressions can read the current state. Use equality, comparisons, addition, subtraction, multiplication, conjunction, disjunction, and parentheses. Use a disjunction of named actions in Next. Write parentheses to group mixed Boolean expressions. The parser uses operator precedence and does not implement indentation-based grouping.

The checker uses breadth-first search. It reports success only after it explores all reachable states. It reports an incomplete check at the state or time limit. Enable deadlock checking to get a trace to a reachable state with no enabled action. The checker does not evaluate liveness, fairness, sets, quantifiers, constants, or full TLC configuration files. The graph shows up to 12 states at once. Select trace steps to inspect additional states.
