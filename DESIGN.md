# Design

## Retries

`withRetry` repeats only a `DaikinConnectionError`: a connection the adapter
refused, reset or closed before answering. By default it tries up to five more
times: at once, then after 50, 100, 200 and 400 ms, so it gives up about 750 ms
after the first failure. The first retry waits for nothing because the likeliest cause, a
reused connection the adapter has already closed, fails at once and is fixed by
a fresh connection.

Rejected: retrying by status, 502, 503 and 504, with a timeout reported as 504.

- A timeout costs a full `timeoutInMs` per attempt, so three attempts kept a
  unit that stopped answering from failing for over 30 seconds.
- An HTTP status the adapter sent, and a `ret` or `rsc` other than OK, is the
  adapter's reply, and asking again gets the same one.
- A status cannot mark a connection failure: DSIOT answers `rsc` 503 itself,
  so the transport throws a class of its own.

Writes are retried as well: each typed write sets absolute values, so repeating
one that landed changes nothing. `reboot()` passes `{ retry: false }`, as should
any caller of `command()`, `multireqGet()` or `multireqUpdate()` whose request
is not safe to repeat.

## The read before a write

`setState` takes only the fields to change, but a write carries more than
those. So `setState` first reads what the unit holds, and builds the write from
that reply:

| Adapter | A write carries | The reply supplies |
| --- | --- | --- |
| Classic | Every control field the unit takes, on each `set_control_info`: `pow`, `mode`, `stemp`, `shum`, `f_rate` and the direction fields. The adapter takes a write without the direction fields, and sets the louvers from one that carries them, so `setState` carries them: a swing mode or a position then goes in the same write as the rest. Whether it takes a write without one of the others is not known, so none is left out. | Each field the control leaves out. On a mode change, the values the adapter remembers for the target mode: `dt3`, `dh3`, `dfr3` and `dfd3` for cool, or `ndfd3` on a unit that reports no `dfd3`. |
| DSIOT | The power, the power transition and the mode on each write, then only the leaves the control changes | The power the unit holds, which decides the transition. The mode, when the control sets none. The `md` of the louver and humidity leaves, which a position and a percentage are encoded from. |

With `maxStateAgeForSetStateInMs` set, `setState` skips that read while the
client's `SetStateCache` holds a reply to `getState` or `getStateAndSensors`
younger than that. A caller that polls sets it to its poll interval, and a
write then costs one request where it cost two. No read is answered from the
cache: `getState` asks the unit every time.

The default is 0, because a write built from an old reply undoes a change made
on the remote control since that reply. Someone switches the unit to heat on
the remote, the caller sets 23 °C from a reply read before that, and the write
puts the unit back in cool.

Every write through the client clears the cache, `command()` with parameters
and `multireqUpdate()` included, so the `setState` after a write reads first.

Rejected: `setState` taking a whole `DaikinState` from the caller in place of
the read. A `DaikinState` holds the current mode's values alone: it has neither
the values a classic adapter remembers for the other modes nor the `md` of a
DSIOT leaf, so the client would still need the reply.

## Discovery

`discoverDevices` sends its probes from the first free UDP port from 30000 to
30050. An adapter answers the port a probe came from, so a reply reaches the
call that sent the probe.

Rejected: port 30000 alone, bound with `reuseAddr`.

- Two calls at the same time both bound the port, and each reply reached one
  of the two sockets alone. One call resolved with every adapter and the other
  with none, and neither rejected.

`discoverDevices` sends each probe to `255.255.255.255` and to the broadcast
address of every IPv4 network the machine is on.

Rejected: `255.255.255.255` alone.

- The machine sends a limited broadcast out of one interface, the one its
  default route uses, so an adapter on a second network, such as Wi-Fi beside
  a wired one, never hears the probe.

`discoverDevices` asks each adapter that replies as a classic one, over HTTP,
whether it is an Airbase adapter: `isAirbaseAdapter` takes HTTP 404 at
`/common/basic_info` with `ret=OK` at `/skyfi/common/basic_info` for one.

Rejected: the protocol from the reply alone.

- An Airbase adapter reports `type=aircon` as a classic adapter does, and no
  field of the reply is known to differ. Discovery reported it as `classic`,
  and it answered HTTP 404 to every request of the client built from that.

Rejected: asking in `createDaikinClient`, for a device written by hand as
well.

- `createDaikinClient` returns a client at once and sends nothing. Asking
  there would make it asynchronous for every caller, to settle what a caller
  who writes a device by hand already knows.

`discoverDevices` resolves with the adapters of air conditioners alone:
`isAirConditioner` passes a reply whose `type` is `aircon`, or `GPF` with a
`cdev` that is not an air cleaner's.

Rejected: a device for every adapter that answers.

- The adapter of an air cleaner, a water heater, a floor heater or a
  circulator answers the probe as well. `parseDevice` read each as a classic
  air conditioner, a `DaikinDevice` had nothing to tell them apart by, and no
  method of the client built from one worked.

## Capabilities

`DaikinCapabilities` lists what a unit accepts in the vocabulary of `DaikinState`:
`fanSpeeds` holds `FanSpeed` values, and `targetTemperaturesInC` holds one range per
`OperatingMode`, `null` where the mode has no setpoint or the unit does not offer it.

Rejected: a `DaikinCapabilities` shaped like the adapter's own flags (`fan.controllable`,
`fan.auto`, `fan.silent`, `fan.steps`, and an `identity` of the raw `cpv`,
`adp_kind`, `reg` and unit `type`), with a `getControlOptions` that turned it
into the values a caller can send.

- A caller could send nothing from `DaikinCapabilities` until `getControlOptions` had
  translated it, so every caller needed both.
- A DSIOT adapter reports none of those flags, so its codec made up classic
  values, `cpv` 3 and `type` C or N, to fill `identity`.

`parseDsiotCapabilities` reads the `adp_i` and `dgc_status` trees itself.

Rejected: `parseDsiotCapabilities` turning the trees into classic `basic_info`
and `get_model_info` fields and passing them to `parseClassicCapabilities`.

- `parseClassicCapabilities` offers the fixed vertical positions only to a unit
  with five of them, so a unit on a DSIOT adapter taking three fixed values
  was offered none, while `parseDsiotState` reported it at `position2`.
- The classic fields cannot carry what the trees say: `s_fdir_ud` has no bit
  for `naturalWind` or `auto`, and the classic limits are whole degrees where a
  DSIOT setpoint counts half degrees.

## Target humidity

`DaikinState.targetHumidity` holds a `HumiditySetting` such as `off` or
`autoHigh`, or a percentage as `{ percent: 50 }`, and
`DaikinCapabilities.targetHumidities` lists, for each mode, the values a unit
takes. `setState` still encodes a percentage it is given, as it encodes a fan
speed outside `DaikinCapabilities.fanSpeeds`.

Rejected: a `targetHumidity` that held a percentage alone, with a
`DaikinCapabilities.targetHumidity` of `true` or `false`.

- A unit outside Japan is set to off or to one of the four named settings, so
  `getState` reported `null` for every setting but off, and the only value a
  caller could send was one such a unit is never set to.
- Each mode takes its own settings: fan takes none, dehumidify takes no off,
  and a unit reports the rest mode by mode, in `s_humd` or by the humidity
  leaves it has.

Rejected: a percentage as a bare `number`, with 0 for off.

- The field holds a setting as often as a quantity, so its name cannot carry
  the unit, and a caller read `targetHumidity: 50` without one.
- Off is a setting, not a quantity: a unit that takes no percentage still
  takes off, so 0 was the one number `DaikinCapabilities.targetHumidities`
  listed beside the named settings.

## Louver positions

`VerticalPosition` and `HorizontalPosition` name each position, such as `swing`
and `position3`, and each codec holds its adapter's encoding. The compiler
rejects a position no adapter has. Which positions a unit takes depends on the
unit and the mode, which no type can say, so `setState` drops a position the
unit does not take, as it drops a `targetTemperatureInC` in a mode without a
setpoint. `DaikinCapabilities.verticalPositions` and `horizontalPositions` list
what a unit takes.

Rejected: positions as the numbers 0 to 25, typed `number`, with
`applyDsiotControl` throwing an `Error` for a number it could not encode.

- The numbers were neither adapter's encoding: classic sends a digit or a
  letter and DSIOT a three-byte value, so a caller had to look up a third
  numbering.
- A caller learned of a mistyped number only when the call ran.
- The `Error` was the one failure of `setState` that was not a
  `DaikinError`.

## Special modes

`DaikinState.specialModes` lists the special modes that are on, and `getState`
reads it on both protocols. `DaikinControl` leaves it out: `setSpecialMode`
turns one mode on or off, with a request of its own on both protocols. A
classic adapter takes it at `/aircon/set_special_mode`, beside
`set_control_info`, and a DSIOT adapter takes one leaf, on the outdoor edge
for powerful where every leaf `setState` writes is on the indoor edge.

Rejected: a `getSpecialModes` on `ClassicDaikinClient`, beside `setSpecialMode`.

- A classic adapter reports the modes in `adv`, in the `get_control_info` reply
  `getState` already reads, so the method sent a second request for a reply the
  caller had.
- A DSIOT adapter reports them in its `dgc_status` trees, and a method on
  `ClassicDaikinClient` gave a caller no way to read those.

`DaikinCapabilities.specialModes` lists the special modes a unit takes mode by
mode, as `targetHumidities` does.

Rejected: one list for the whole unit.

- Econo is not known to be taken in fan mode, so the one list offered it in a
  mode where UNSUPPORTED.md lists it as unknown.

## Simulators

`startClassicSimulator`, `startDsiotSimulator` and `startAirbaseSimulator`
each start an adapter as a server. A simulator shares the codecs' tables, `src/codecs/*/tables.ts`, and
none of their functions. A table holds what an adapter calls a thing: its
field and leaf names, and the code for each value. A function does something
with it: a codec parses a reply and builds a request, and a simulator answers
the request, holds what it was sent, and builds the reply.

Rejected: a simulator that builds its replies with the codecs' functions.

- A simulator built from a codec agrees with it by construction. A codec that
  reads a field wrongly would meet a simulator that writes it wrongly the same
  way, and the test of one against the other would pass.

Rejected: a simulator with tables of its own, sharing nothing with the codecs.

- Every code was written twice, in two files that had to be kept alike, and a
  caller setting a field of a simulator by hand had no table to read it from.
- The second writing caught a wrong code only where the simulator encoded a
  value itself. `tables.test.ts` writes every entry out again, and catches
  one wherever it is used.

`package.json` exports the simulators as `daikin-local-control/simulators`,
an entry of their own beside the package root.

Rejected: exporting them from the package root.

- A caller's production code imports the root. With the simulators in it, that
  import loads two servers the code never starts, and a bundler has to work
  out that it can drop them.

A simulator holds its state in the adapter's terms, `controlInfo.stemp` on a
classic simulator and a leaf's `pv` by its address on a DSIOT one, and takes
it in the package's models: a `DaikinState`, a `DaikinSensors` and a
`DaikinDeviceInfo`. It turns a model into the adapter's fields with functions
of its own, in `src/simulators/`, so a client that reads the state back
checks the codec that parses it against a second writing of the same
encoding.

Rejected: options in the adapter's terms alone, a record of strings for each
reply.

- A caller had to know the adapter's encodings to start a unit in a state: a
  DSIOT setpoint of 24 °C is the leaf value `3000`.

A classic or a DSIOT simulator takes what the unit has as a
`DaikinSimulatorUnit`, which says it in terms both protocols have flags for:
`coolingOnly`, `swing`, `fan`. An Airbase simulator takes an
`AirbaseSimulatorUnit` of its own: an Airbase unit has zones and airside, and
neither a cooling-only kind nor a special mode.

Rejected: taking a `DaikinCapabilities`.

- Most values of it are ones no adapter reports. Fan speeds of `auto`,
  `level1` and `level3` have no `frate_steps`, and a DSIOT adapter reports
  every fan speed or none, so the simulator would throw for most of what the
  type allows.

A simulator answers HTTP 501 to a request whose answer from an adapter is not
known, such as a path it does not serve.

Rejected: answering such a request the way an adapter plausibly would, with
HTTP 404 or `ret=PARAM NG`.

- A caller's test would then pass or fail on an answer no adapter is known to
  give. No adapter is known to answer 501, so a caller cannot take it for an
  adapter's reply.

A simulator answers one request at a time, and a request that arrives
meanwhile waits for its turn: an adapter makes concurrent requests wait.
`replyDelayInMs` makes the wait long enough for a test to see. Whether an
adapter also drops a connection while it is busy is not known, so a simulator
never does.

A simulator answers the discovery probe only when started with
`answersDiscovery`.

Rejected: answering it always.

- An adapter answers on UDP port 30050, a fixed port, so a simulator that
  always bound it could not start beside another program that holds it, in a
  test that never discovers anything.

Each simulator is at one `address` of the machine, `127.0.0.1` unless it is
given another. It answers the probe from that address, and the simulators
share port 30050: each hears the probe on a socket bound to every address,
and answers from a second socket bound to its own.

Rejected: one socket for each simulator, bound to port 30050 of its own
address.

- The probe is a broadcast to `255.255.255.255`, and a socket bound to one
  address receives none of it: two simulators bound that way answered no
  probe.

Rejected: one socket bound to every address, answering from it.

- The machine then picks the address a reply leaves from, its address on the
  LAN, so `discoverDevices` reports the simulator there, and the simulator
  has to listen for HTTP on the LAN where a test needs loopback alone.

`discoverDevices` keeps one device for each `host`, the address a reply came
from with the `api_port` it announces, so it finds every simulator on a
machine: they answer from one address and announce a port each.

Rejected: one device for each address.

- Simulators on one machine share its addresses, so a caller could have as
  many discovered as the machine has addresses, two on a laptop.
