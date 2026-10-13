# Working in this repository

Everything a reader acts on is in [README.md](README.md). A decision that took
an argument to reach goes in `DESIGN.md`; read it, once it exists, before
changing the code it covers.

## Instructions for agents

- **Put a standing instruction in this file, not in agent memory.** This file
  reaches every agent and every contributor; memory reaches one agent on one
  machine.
- **Write only rules that bind future work.** An instruction given for one task
  is carried out in that task and not recorded here, and so is the history of
  how a rule came about.

## Before you write code

- **Check the dependency's defaults first.** Read what a library or the
  platform already does before writing code to do it.
- **KISS and YAGNI.** Keep it thin. Push test machinery into the test file
  rather than adding an injection point to production code.
- **Delete anything you did not use.**
- **Add a dependency only when it earns more than it replaces.**
- **No configuration value without a reason.** Keep a tool's default unless a
  specific requirement forces the change, and write the reason in a comment
  beside the value. Where the format takes no comment, such as `package.json`,
  record it in `DESIGN.md`.
- **Build only confirmed protocol.** Implement an endpoint, parameter or value
  encoding only when its exact request and reply are known. List anything else
  in [UNSUPPORTED.md](UNSUPPORTED.md) with what is unknown; never ship a guess.
- **Two independent open-source clients that agree confirm a behaviour**
  where no Daikin app shows it. One client alone does not, and neither does a
  second that copies the first.
- **The package never reads the environment.** Nothing under `src/` reads
  `process.env` or picks up configuration on the caller's behalf: the caller
  passes it in.

## Layers

| Folder | Holds | Never holds |
| --- | --- | --- |
| `src/models/` | The types a caller passes and receives, in the package's own terms | An adapter field name, code or value encoding |
| `src/codecs/` | Every adapter field name, code and value encoding, as pure functions between adapter fields and models | I/O |
| `src/clients/` | Which route to call, in what order, through which codec | An adapter field name, code or value encoding |
| `src/simulators/` | An adapter of each protocol as a server: how it answers a request, and what it holds and remembers | An import from `src/clients/`, or from `src/codecs/` other than a `tables.ts` |

- **Describe a capability in the vocabulary of the control it limits**:
  `fanSpeeds: FanSpeed[]`, not the adapter's flags.
  [DESIGN.md](DESIGN.md#capabilities) says why.
- **Pass an adapter code through a model only when what it stands for is not
  known**, and list it in [UNSUPPORTED.md](UNSUPPORTED.md) under "Not modelled".
- **Keep a table of names or codes in its codec's `tables.ts`**, and write
  each entry out again in `tables.test.ts`. The codecs and the simulators both
  read a table, so a wrong code is wrong on both sides and they still agree:
  the test is the second writing that catches it.
- **A simulator imports a codec's `tables.ts` and none of its functions.** A
  test of a client against a simulator checks the codec's functions against
  the simulator's only while the two share none:
  [DESIGN.md](DESIGN.md#simulators) says why. Export a simulator from
  `src/simulators/index.ts` alone, never from `src/index.ts`. Answer HTTP 501
  where an adapter's answer is not known, and list any other answer that is
  not known to be an adapter's in [UNSUPPORTED.md](UNSUPPORTED.md#simulators).

## Comments

- **No comments except gotchas.** A comment explains behaviour the reader
  cannot see. A comment that restates the line below it gets deleted.
- **Write a gotcha on an export or its public member as `/** */`, not `//`**:
  a caller's editor shows it. Write it as prose, without `@param` or
  `@returns` tags.
- **State an optional option's default in its `/** */`**, as a sentence:
  `Defaults to 10000.` An option that forwards to another type's field repeats
  the value and links to that field for the rest: a caller's editor shows only
  the comment on the option they hover.
- **Two markers, each with its own meaning.** Capitalise each one, and write
  the text after it as a full sentence.
  - `// TechDebt:` marks a shortcut taken because doing it properly is not worth
    it today. The marker carries its own reasoning, and that reasoning never
    moves to `DESIGN.md`: what was cut short, why that is acceptable now, and
    what pays it back.
  - `// TODO:` is work not yet done, due as a next step.

## Names

- **Abbreviate only where the abbreviation is well known.** `Info`, `Config`,
  `min`, `max`, and an initialism such as `UUID`, `MAC` or `URL` are. Write any
  other word in full: `parameters`, not `params`; `options`, not `opts`;
  `temperature`, not `temp`. A name the device protocol defines keeps its
  spelling, such as `f_dir_ud` or `adp_kind`.
- **Name a file for what it exports, and let its folder carry the rest**:
  `clients/classic.ts`, not `clients/classicClient.ts`. Keep the name singular
  unless the export's own name is plural: `state.ts` for `DaikinState`,
  `capabilities.ts` for `DaikinCapabilities`.
- **Prefix an export with `Daikin` when its bare name is a word the caller's
  own code would also use**: `DaikinClient`, `DaikinDevice`, `DaikinState`,
  `DaikinCapabilities`. Leave a name that is already specific bare: `FanSpeed`,
  `SwingMode`.
- **A function is its verb plus the bare noun**: `discoverDevices`,
  `parseDevice`. Its argument and return types already say `Daikin`.
  `createDaikinClient` is the one exception: it is the package's entry point,
  and `createClient` is a name other libraries export.
- **An implementation puts its variant in front of the interface's full name**:
  `ClassicDaikinClient` and `DsiotDaikinClient` for `DaikinClient`. It drops
  the `Daikin` when the variant alone makes the name specific:
  `ClassicLocalPasswordAuthentication` for `DaikinAuthentication`.
- **A protocol-specific codec export names its protocol**: `parseClassicState`,
  `DSIOT_PATHS`. A caller imports an export by its name alone, so the name
  carries what the folder would.
- **A codec function that converts starts with the verb for its conversion**:

  | Verb | Turns |
  | --- | --- |
  | `parse` | An adapter reply into a model |
  | `apply` | A control and the current reply into a request |
  | `encode`, `decode` | One value to and from its adapter encoding |
  | `build` | Arguments into a request body |

- **A constant holding several values is plural**, and a list of a type's
  values takes the type's name: `FAN_SPEEDS` for `FanSpeed`.
- **An options type is its function's or class's name plus `Options`**:
  `CreateDaikinClientOptions`.
- **A name carrying a unit spells it after `In`**. Milliseconds abbreviates to
  `Ms` and degrees Celsius to `C`: `timeoutInMs`, `DEFAULT_TIMEOUT_IN_MS`,
  `targetTemperatureInC`, `indoorHumidityInPercent`.

## Version the package with semver

Leave `version` in `package.json` at `0.0.0`: publishing a GitHub release sets
the version from its tag, and CI publishes the package. Pick the release's
version by what the changes since the last release do to everyone who installs
the package:

| The change | Bump | Example |
| --- | --- | --- |
| A bug fix, or anything a caller's code survives untouched | Patch | `1.4.2` → `1.4.3` |
| A capability added: a new export, a new optional field | Minor | `1.4.2` → `1.5.0` |
| A caller has to be edited: an export removed or renamed, a signature changed, an optional field made required | Major | `1.4.2` → `2.0.0` |

Before `1.0.0`, a change that makes callers edit their code bumps the minor
(`0.13.0` → `0.14.0`), and everything else bumps the patch. Take the level of
the largest change in the release.

## Pull requests, commits, and comments

- **Say who does what, in order.** "undici times out, so the transport throws a
  `DaikinError` with status 504", never "a timeout surfaces as a 504".
- **Call a thing what the code calls it.** A buzzword or metaphor makes the
  reader translate it before they can act on it. Name the function, the
  endpoint, or the check.
- **A person merges.** Never merge a pull request unless told to merge that
  one, even when it is green and approved. Stop at ready to merge, and say which
  pull request to merge and what it unblocks.
- **Resolve a review thread once its fix is pushed**, with the GraphQL
  `resolveReviewThread` mutation. Leave a thread open only while it is
  unaddressed or waits on a person's decision.

## Documents

- **Say what to do, not what the project is.** Write only what a reader acts
  on: how to install it, how to call it, what it answers, what breaks. Prefer a
  table or a code block to a paragraph, and cut any sentence the reader would
  not miss.
- **The instruction comes first, the reason second.** Open on the imperative
  and put the reason behind a colon or a dash. The reason stays; only its
  position changes.
- **A heading names what is under it.** "Caching", not "What it is careful
  about". A table column is `Holds`, `Meaning`, or `Why`, never `Is`.
- **Delete rather than rephrase** a comment restating the command beside it, an
  example repeating an earlier one, a consequence anyone already knows, an
  aphorism standing where an instruction belongs, and a generic caution in
  place of the specific trap.
- **Describe the adapter, not a source.** Code, comments, tests, docs and
  commit messages state what the adapter accepts and returns, in its own terms.
  Cite no other client or tool as the source of a behaviour; name another
  product only to state compatibility, as the README does.
- **One fact has one home.** Explain it where it is decided, and link to that
  from everywhere else.
- **Record a decision where it will be read again.** A decision whose
  alternative was built and rejected goes in `DESIGN.md`: what was chosen, what
  was rejected, and the fact that decided it. The README links to it in one line
  and carries none of the argument.
