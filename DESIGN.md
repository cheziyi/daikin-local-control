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
| Classic | Every control field the unit takes, on each `set_control_info`: `pow`, `mode`, `stemp`, `shum`, `f_rate` and the direction fields. Whether the adapter takes a request without one of them is not known, so none is left out. | Each field the control leaves out. On a mode change, the values the adapter remembers for the target mode: `dt3`, `dh3`, `dfr3` and `dfd3` for cool. |
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
reads it on both protocols. `DaikinControl` leaves it out, so `setState` is
never handed a field it cannot write: UNSUPPORTED.md says what is not known.

Rejected: a `getSpecialModes` on `ClassicDaikinClient`, beside `setSpecialMode`.

- A classic adapter reports the modes in `adv`, in the `get_control_info` reply
  `getState` already reads, so the method sent a second request for a reply the
  caller had.
- A DSIOT adapter reports them in its `dgc_status` trees, and a method on
  `ClassicDaikinClient` gave a caller no way to read those.
