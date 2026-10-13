# daikin-local-control

[![npm version](https://img.shields.io/npm/v/daikin-local-control)](https://www.npmjs.com/package/daikin-local-control)
[![npm downloads](https://img.shields.io/npm/dm/daikin-local-control)](https://www.npmjs.com/package/daikin-local-control)
[![CI](https://github.com/cheziyi/daikin-local-control/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cheziyi/daikin-local-control/actions/workflows/ci.yml?query=branch%3Amain)
[![Node version](https://img.shields.io/node/v/daikin-local-control)](package.json)
[![Types](https://img.shields.io/npm/types/daikin-local-control)](package.json)
[![License](https://img.shields.io/npm/l/daikin-local-control)](LICENSE)
[![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

A TypeScript and Node.js client for controlling Daikin air conditioners **over
the local network** (LAN), through their Wi-Fi adapters and with no cloud
dependency. It implements the local-control protocols of the **DAIKIN Mobile
Controller**, **Daikin Airbase** and **ONECTA** apps, so it works with the units
and Wi-Fi adapters those apps support — split / multi-split, SkyAir and ducted
units fitted with adapters such as the BRP072A42, BRP072C42, BRP084, BRP069 and
BRP15B61 — in the [markets where those apps are used](#coverage--limitations).

Daikin Wi-Fi adapters speak one of three protocols, and the package has a
client for each:

- **`ClassicDaikinClient`** — classic adapters (BRP072A42, BRP072C42, BRP069).
  Full core control plus typed [extended controls](#extended-controls).
- **`DsiotDaikinClient`** — newer DSIOT adapters (BRP084). Power, mode,
  setpoint, humidity, fan, swing, louver positions and special modes;
  [UNSUPPORTED.md](UNSUPPORTED.md) lists what is not mapped yet.
- **`AirbaseDaikinClient`** — Airbase adapters (BRP15B61) on ducted units.
  Power, mode, setpoint, fan and direction, plus [zones](#airbase), fan auto
  and airside.

You normally don't pick one yourself: `createDaikinClient` chooses the right
client for each discovered device.

## Installation

```bash
npm install daikin-local-control
```

It needs Node 22.19 or later, and its types are included.

Before `1.0.0`, only a minor release (`0.1.x` to `0.2.0`) can require changes
to your code, and the `^` range npm saves by default never crosses one.

## Usage

```ts
import { discoverDevices, createDaikinClient } from "daikin-local-control";

// 1. Find adapters on the LAN (UDP broadcast DAIKIN_UDP/common/basic_info :30050).
const [device] = await discoverDevices();
if (device === undefined) {
  throw new Error("No adapter answered");
}

// 2. Build the right client: createDaikinClient picks the classic, the DSIOT
//    or the Airbase client from the device. Pass localPassword only when the
//    adapter has a child lock code (see Credentials below).
const client = createDaikinClient(device, {
  terminalUuid: savedUuid, // generated once and stored (see Credentials below)
  localPassword: device.requiresLocalPassword ? "<child lock code>" : undefined,
});

// 3. Capabilities are data — branch on them, don't special-case device types.
const capabilities = await client.getCapabilities();
if (capabilities.swingModes.includes("both")) {
  /* this unit swings on both axes */
}

// 4. Read and control.
const state = await client.getState();
await client.setState({ power: true, mode: "cool", targetTemperatureInC: 24 });

const { indoorTemperatureInC } = await client.getSensors();

// 5. Close the connection to the adapter when you're done with the unit.
await client.close();
```

### Discovery

`discoverDevices()` resolves with one `DaikinDevice` for each air conditioner's
adapter that answered, and with an empty array when none did. Each carries the
adapter's `macAddress`, such as `A4:08:EA:CC:91:D4`, and `firmwareVersion`,
such as `1.2.51`, when the adapter reports them: key a stored device on
`macAddress`, because `host` changes when the adapter is given a new address.

| It | So |
| --- | --- |
| Resolves after `timeoutInMs`, never earlier | Pass `discoverDevices({ timeoutInMs: 1000 })` to wait less than the default 3000 |
| Broadcasts to `255.255.255.255` | It does not find an adapter on another subnet or VLAN |
| Keeps the adapters of air conditioners alone | It leaves out the adapter of an air cleaner, a water heater or another appliance, which answers the same broadcast |
| Asks each classic adapter over HTTP whether it is an Airbase adapter, which replies to the broadcast as a classic one does | It resolves later than `timeoutInMs` while an adapter is slow to answer, by 3000 ms at most for each request after up to 750 ms of retrying a dropped connection, and reports as `classic` one that does not answer. An Airbase device requires no registration and no child lock code, whatever the adapter's reply says |
| Binds the first free UDP port from 30000 to 30050 | Calls made at the same time each get every reply. It rejects with the socket's error when none of the ports is free, or when the socket fails |

Write the device by hand when you already know its address, or when discovery
cannot reach it:

```ts
import { createDaikinClient, type DaikinDevice } from "daikin-local-control";

const device: DaikinDevice = { host: "192.168.1.50", protocol: "classic" };
const client = createDaikinClient(device, { terminalUuid: savedUuid });
```

A device written by hand has no `name`, `macAddress` or `firmwareVersion`: read
them from the adapter with `await client.getDeviceInfo()`.

To tell an Airbase adapter from a classic one by its address, request
`/common/basic_info`: an Airbase adapter answers HTTP 404 there, and `ret=OK`
at `/skyfi/common/basic_info`.

Set `protocol` to `dsiot` for a BRP084, to `airbase` for a BRP15B61 and to
`classic` for every other adapter: `createDaikinClient()` goes by it and asks
the adapter nothing. A device without flags is an adapter that requires neither
registration nor a child lock code. If yours requires either, set
`requiresRegistration: true` / `requiresLocalPassword: true` and set up
[credentials](#credentials) to match; add `usesHttps: true` if it also speaks
HTTPS. The flags are independent, and discovery reads them all from the adapter
for you.

### Credentials

An adapter can need up to three things. Discovery tells you which ones apply
(`device.requiresRegistration`, `device.requiresLocalPassword`). An Airbase
adapter takes none of them: `createDaikinClient()` still takes a
`terminalUuid`, and sends it nothing of the three.

**Terminal uuid (always).** It identifies your app to the adapter. Pass 32
lowercase hexadecimal digits, a UUID without its dashes: `createDaikinClient()`
throws an `Error` for any other form, and sends the uuid as given. Generate it
**once**, store it, and reuse it on every run: an adapter that requires
registration remembers it, so a new uuid means registering again.

```ts
import { randomUUID } from "node:crypto";

const savedUuid =
  loadFromConfig() ?? saveToConfig(randomUUID().replaceAll("-", ""));
```

**KEY (when `device.requiresRegistration` is `true`).** These
adapters only answer terminals they have registered. Each adapter's KEY is
printed on its label, next to the SSID (also in the operation manual). Register
your uuid with it once. Until you do, every call fails with HTTP 401/403.
Each uuid is registered separately, so an adapter already set up in a Daikin
app still needs registering here.

```ts
import { ClassicDaikinClient } from "daikin-local-control";

if (device.requiresRegistration && client instanceof ClassicDaikinClient) {
  await client.registerTerminal("<KEY from the label>");

  // To unregister later: this uuid (default), every other uuid, or all of them.
  // await client.unregisterTerminal("others");
}
```

Registration applies to classic adapters only; DSIOT adapters don't use it.

Some of these adapters also switch to HTTPS (`device.usesHttps`); see
[Local HTTPS](#local-https).

**Child lock code (when `device.requiresLocalPassword` is `true`).** The protocol
calls it the local password (`lpw`). It is the 4-digit code set under Child lock
in the Daikin app the adapter was set up with. It is **not** printed on the
label, and it is not your Wi-Fi or Out-of-Home password. Pass it as `localPassword` to
`createDaikinClient`. If it's forgotten, the adapter has to be reset.

### State and capabilities

`getState()` resolves with a `DaikinState`:

| Field | Holds |
| --- | --- |
| `power` | `true` or `false` |
| `mode` | `auto`, `dehumidify`, `cool`, `heat` or `fan` |
| `targetTemperatureInC` | A number, or `null` in a mode without a setpoint |
| `targetHumidity` | `off`, `autoLow`, `auto`, `autoHigh` or `continuous`, or `null` when the unit has no humidity setting. A Japanese unit set to a percentage reads as `{ percent: 50 }`; `getCapabilities()` never lists a percentage, so `setState()` sends one unchecked: see [UNSUPPORTED.md](UNSUPPORTED.md) |
| `fanSpeed` | `auto`, `silent`, or `level1` to `level5` |
| `swingMode` | `off`, `vertical`, `horizontal` or `both`: `vertical` moves the air up and down, `horizontal` left and right |
| `verticalPosition` | `stop`, `position1` to `position5`, `swing`, `naturalWind`, `auto` or `floorWarming`, or `null` where the unit reports none |
| `horizontalPosition` | `stop`, `position1` to `position5`, `swing` or `auto`, or `null` where the unit reports none |
| `specialModes` | Those of `powerful`, `econo` and `streamer` that are on, empty when none is |

`getCapabilities()` resolves with a `DaikinCapabilities`, which lists the
values this unit takes under the plural of the state field each one limits:

| Field | Holds |
| --- | --- |
| `modes` | The modes the unit offers |
| `fanSpeeds`, `swingModes`, `verticalPositions`, `horizontalPositions` | The values the unit takes, empty when it has no such control |
| `targetTemperaturesInC` | For each mode, `{ min, max, step }` in °C, or `null` where the mode has no setpoint |
| `targetHumidities` | For each mode, the humidity settings it takes, empty where it takes none |
| `specialModes` | For each mode, the special modes the unit takes, empty where it takes none |
| `specialOutlet`, `energyMonitoring`, `demandControl`, `scheduleTimer` | `true` when the unit has the feature |
| `model` | The adapter's own code for the unit's model |

`getSensors()` resolves with `indoorTemperatureInC`, `outdoorTemperatureInC`
and `indoorHumidityInPercent`, each `null` when the unit does not report it.

Call `getStateAndSensors()` when you want both: it resolves with
`{ state, sensors }`, and a DSIOT adapter answers it in one request, where
`getState()` then `getSensors()` sends the same request twice.

### Changing state

Pass `setState()` only the fields to change: a field left out keeps the value
the unit holds for the target mode.

Check a value against `getCapabilities()` before sending it: `setState()`
resolves without an error when it drops a field, and sends any other value as
given, whether or not the unit lists it.

| Field | `setState()` drops it |
| --- | --- |
| `targetTemperatureInC` | In `fan` and `dehumidify` |
| `targetHumidity` | In `fan` |
| `fanSpeed` | In `dehumidify`, and on a DSIOT adapter in `cool` while a humidity setting is on: the fan runs on `auto` |
| `verticalPosition`, `horizontalPosition` | On a classic adapter, when the unit has no 3D airflow. On a DSIOT adapter, a fixed vertical position the unit lacks, and every fixed horizontal position. On an Airbase adapter, always |

An Airbase adapter also drops every `targetHumidity`, and a
`targetTemperatureInC` in `fan` as well as in `dehumidify`.

`setState()` takes no `specialModes`: turn one on or off with
`setSpecialMode()`, which sends a request of its own. Check the mode against
`getCapabilities().specialModes` first: the client sends any mode as given.
An Airbase adapter has no request for one, so `AirbaseDaikinClient` rejects
with a `DaikinError` whose `httpStatusCode` is 501.

```ts
await client.setSpecialMode("powerful", true);
```

Pass `maxStateAgeForSetStateInMs` to `createDaikinClient` when you poll the
state anyway: `setState()` reads the unit before each write, and with it builds
the write from a `getState()` or `getStateAndSensors()` reply younger than that
instead. It changes no read: `getState()` asks the unit every time.

```ts
const client = createDaikinClient(device, {
  terminalUuid: savedUuid,
  maxStateAgeForSetStateInMs: 30_000, // your poll interval, in milliseconds
});
```

The write undoes a change made on the remote control since that reply:
[DESIGN.md](DESIGN.md#the-read-before-a-write) says how.

### Extended controls

Beyond core climate, `ClassicDaikinClient` exposes the adapter's other `set_*`
endpoints as typed methods, plus a raw `command()` hatch for anything without a
wrapper. Narrow to the concrete class to reach them:

```ts
import { ClassicDaikinClient } from "daikin-local-control";

if (client instanceof ClassicDaikinClient) {
  await client.setLed(false);
  await client.setHolidayMode(true);
  await client.setDemandControl({
    enabled: true,
    maxPowerInPercent: 70,
    mode: "manual",
  });
  await client.setOutOfHomeAccess(false); // home network only
  await client.setEnergyPrice(0.3); // per kWh
  await client.setMetadata({
    name: "Living Room",
    group: { name: "Upstairs", enabled: true },
  });
  await client.reboot();

  // Any other endpoint, by its path: the reply's key=value fields come back.
  const basicInfo = await client.command("/common/basic_info");
}
```

Read a setting back with the matching `get` method:

| Method | Resolves with |
| --- | --- |
| `getLed()`, `getHolidayMode()`, `getOutOfHomeAccess()` | `true` or `false`, or `null` when the adapter does not report it |
| `getMetadata()` | `{ name, icon, group }`, without the fields the adapter does not report |

[UNSUPPORTED.md](UNSUPPORTED.md) lists the endpoints without a typed method and
what is not known about each.

`DsiotDaikinClient` has `reboot()` and the raw `multireqGet` / `multireqUpdate`
hatches for any `dgc_status` leaf.

### Airbase

`AirbaseDaikinClient` adds the controls a ducted unit has. Narrow to the
concrete class to reach them:

```ts
import { AirbaseDaikinClient } from "daikin-local-control";

if (client instanceof AirbaseDaikinClient) {
  const zones = await client.getZones(); // [{ name: "Living", enabled: true }, ...]
  await client.setZone(1, true); // open the second zone

  if ((await client.getFanAuto()) !== null) {
    await client.setFanAuto(true);
  }
  if ((await client.getAirside()) !== null) {
    await client.setAirside(true);
  }

  // Any other endpoint, by its path below /skyfi.
  const holiday = await client.command("/common/get_holiday");
}
```

| Method | Does |
| --- | --- |
| `getZones()` | Resolves with `{ name, enabled }` for each zone, in the unit's order, and with an empty array on a unit without zones |
| `setZone(index, enabled)` | Opens or closes the zone at that place in `getZones()`, counted from 0 |
| `getFanAuto()`, `getAirside()` | Resolve with `true` or `false`, or `null` on a unit that does not take the setting |
| `setFanAuto(enabled)` | Lets the unit pick the fan speed itself, up to the `fanSpeed` that is set. It switches airside off |
| `setAirside(enabled)` | Switches airside on or off. Switching it on switches fan auto off and sets `fanSpeed` to `level1` |

A `fanSpeed` in `setState()` switches airside off and keeps fan auto.

Only a unit with zones takes fan auto and airside, and it takes no `auto` fan
speed and no `swingMode`: `getCapabilities()` lists what a unit takes.

### Errors and retries

A client method that fails rejects with a `DaikinError`; branch on
`httpStatusCode`:

| `httpStatusCode` | Meaning |
| --- | --- |
| 401 | The adapter rejected the credentials: `ret=AUTH NG` or `LPW NG`, or DSIOT `rsc` 401 or 4001 |
| 502 | The adapter answered with an error: a `ret` or `rsc` other than OK, or a reply that does not parse |
| 503 | The adapter refused or dropped the connection (a `DaikinConnectionError`), or DSIOT answered `rsc` 503 |
| 504 | The request timed out, or the TLS handshake failed |
| 501 | `AirbaseDaikinClient.setSpecialMode()`: an Airbase adapter has no request for a special mode |
| Any other | The adapter's own HTTP status, such as 403 |

Four failures are not a `DaikinError`: `discoverDevices()` rejects with the
socket's error, `createDaikinClient()` throws an `Error` for a
[terminal uuid](#credentials) in the wrong form, `multireqUpdate()` throws
an `Error` for a path that names a resource without a leaf, such as
`dgc_status`, and `setZone()` rejects with an `Error` for an index the unit
has no zone at.

Only a `DaikinConnectionError` is retried, up to five times by default.
[DESIGN.md](DESIGN.md#retries) says why.

| To | Pass |
| --- | --- |
| Change how often and how long a client retries | `retry: { delaysInMs: [0, 500] }` to `createDaikinClient`: one wait, in milliseconds, before each retry |
| Stop a client retrying | `retry: { delaysInMs: [] }` to `createDaikinClient` |
| Send one request that is not safe to repeat | `{ retry: false }` as the last argument of `command()`, `multireqGet()` or `multireqUpdate()` |

### Simulators

Test your code against a simulated adapter instead of a real one: start a
simulator, and point a client at its `host`. Import the simulators from
`daikin-local-control/simulators`: the package root does not export them.

```ts
import { createDaikinClient } from "daikin-local-control";
import { startClassicSimulator } from "daikin-local-control/simulators";

const simulator = await startClassicSimulator({
  deviceInfo: { name: "Bedroom", macAddress: "A4:08:EA:CC:91:D4" },
  unit: { coolingOnly: true, swing: "vertical" },
  state: { power: true, targetTemperatureInC: 22 },
  sensors: { indoorTemperatureInC: 27 },
});
const client = createDaikinClient(
  { host: simulator.host, protocol: "classic" },
  { terminalUuid: savedUuid },
);

await client.getState(); // power: true, mode: "cool", targetTemperatureInC: 22

simulator.setState({ power: false }); // someone uses the remote control
simulator.setSensors({ indoorTemperatureInC: 24 }); // the room cools down

await client.close();
await simulator.stop();
```

`startDsiotSimulator()` starts a DSIOT adapter and takes the same options:
pass `protocol: "dsiot"` to `createDaikinClient`.
`startAirbaseSimulator()` starts an [Airbase adapter](#airbase-simulator):
pass `protocol: "airbase"`. A simulator speaks plain HTTP on a free port of
`127.0.0.1`, which nothing outside the machine reaches.

Describe the adapter and its unit in the types the clients resolve with:

| Option | Holds | Defaults to |
| --- | --- | --- |
| `deviceInfo` | `name`, `macAddress` and `firmwareVersion`, as `getDeviceInfo()` reads them | A name of `Simulator` |
| `unit` | What the unit has: see below | A heat pump with every fan speed, swing on both axes and all three special modes |
| `state` | Any fields of a `DaikinState`, `specialModes` included | Off, in cool at 24 °C, on the auto fan speed |
| `sensors` | Any fields of a `DaikinSensors`; `null` is a reading the unit lacks | 26 °C and 55 % indoors, 30 °C outdoors |

| `unit` field | Holds | Defaults to |
| --- | --- | --- |
| `coolingOnly` | `true` for a unit that offers dehumidify, cool and fan alone | `false` |
| `fan` | `false` for a unit whose fan speed cannot be set | `true` |
| `fanLevels` | 2, 3 or 5 fan levels. Classic simulator only | 5 |
| `swing` | `none`, `vertical` or `both` | `both` |
| `specialModes` | Those of `powerful`, `econo` and `streamer` the unit takes | All three |
| `coolTemperaturesInC`, `heatTemperaturesInC` | `{ min, max }` | 18 to 32 and 10 to 30 |

`setState()` and `setSensors()` change a running simulator the same way.
`setState()` throws an `Error` for a field the unit has nothing to hold, such
as a `verticalPosition` on a unit without fixed louver positions.

#### Airbase simulator

`startAirbaseSimulator()` takes `deviceInfo`, `state` and `sensors` as the
other two do, and a `unit` of its own. It reports no humidity unless
`sensors` gives one, and its `setState()` throws an `Error` for a
`targetHumidity`, a louver position or a special mode.

```ts
import { startAirbaseSimulator } from "daikin-local-control/simulators";

const simulator = await startAirbaseSimulator({
  unit: { zones: ["Living", "Bedrooms"], airside: true },
  state: { power: true, fanSpeed: "level3" },
});

simulator.setZone(1, false); // someone closes a zone on the wall controller
simulator.controlInfo.f_auto = "1"; // and switches fan auto on
```

| `unit` field | Holds | Defaults to |
| --- | --- | --- |
| `zones` | The names of the unit's zones, each open at the start | None: a unit without zones |
| `auto`, `dehumidify` | `false` for a unit that does not offer the mode | `true` |
| `fan` | `false` for a unit whose fan speed cannot be set | `true` |
| `fanLevels` | 2 or 3 fan levels | 3 |
| `airside` | `true` for a unit with zones that takes airside | `false` |
| `swing` | `false` for a unit without zones that takes no direction | `true` |
| `coolTemperaturesInC`, `heatTemperaturesInC` | `{ min, max }`, in whole degrees | None reported, so 18 to 32 and 10 to 30 |

A unit with zones takes fan auto, and no `auto` fan speed and no direction.
It answers HTTP 404 to a path outside `/skyfi`, as an Airbase adapter does,
so `discoverDevices()` reports it as `airbase` when it is started with
`answersDiscovery`.

| To | Do |
| --- | --- |
| Check what the unit holds | Call `getState()` on a client |
| Check what your code sent | Read `simulator.requests`: each has `method`, `path`, `query`, `headers` and `body` |
| Require registration (classic) | Pass `key`: the simulator answers HTTP 403 until `registerTerminal()` is given it |
| Require the child lock code | Pass `localPassword` |
| Make the adapter slow | Pass `replyDelayInMs`: it answers one request at a time, so a second request waits for the first |
| Make the adapter unreachable | `await simulator.stop()` |
| Reach it from another machine | Pass `address`, an address of this machine other than the default `127.0.0.1` |
| Have `discoverDevices()` find it | Pass `answersDiscovery: true` |

Start as many discoverable simulators as you like, in one process or several:
`discoverDevices()` resolves with one device for each, at `127.0.0.1` and the
simulator's own port.

`discoverDevices()` broadcasts the probe, so it also finds the real adapters
on the LAN, and it needs a network to broadcast on. Only a program that is
not a simulator gets in the way: while one holds UDP port 30050, starting a
simulator with `answersDiscovery` rejects with the socket's error.

For anything the options above do not cover, such as humidity settings or
fixed louver positions, set the adapter's own fields. A classic simulator
takes `basicInfo`, `modelInfo`, `controlInfo` and `sensorInfo`, the fields of
each reply, and holds them under the same names. An Airbase simulator takes
those four and `zoneSetting`. A DSIOT simulator takes `leaves`, and holds each
leaf by its address. A field given this way replaces
what `unit` sets, and `state` and `sensors` replace it in turn. The package
root exports the adapter's codes as tables, such as `CLASSIC_FAN_SPEED_CODES`
and `DSIOT_PATHS`.

```ts
// A classic unit with 3D airflow: both louvers, and five fixed positions.
const classic = await startClassicSimulator({
  modelInfo: { en_fdir2: "1", s_fdir_ud: "81", s_fdir_ud_step: "5", s_fdir_lr: "1" },
  controlInfo: { f_dir_ud: "0", f_dir_lr: "0" },
});
classic.setState({ verticalPosition: "position3" });

// A DSIOT unit that takes a humidity setting in cool.
const dsiot = await startDsiotSimulator({
  leaves: {
    "/dsiot/edge/adr_0100.dgc_status.e_1002.e_3001.p_0C": { pv: "00", pt: 2 },
  },
});
dsiot.setState({ targetHumidity: "auto" });
```

A simulator answers HTTP 501 to a request it has no answer for, so a client
rejects with a `DaikinError` whose `httpStatusCode` is 501.
[UNSUPPORTED.md](UNSUPPORTED.md#simulators) lists what a simulator leaves out,
and each answer that is not known to be a real adapter's.
[DESIGN.md](DESIGN.md#simulators) says what a simulator shares with the
clients' codecs, and why no more.

## Coverage & limitations

It supports the Wi-Fi adapters of three apps, in the markets where each is
used, so it is **not valid for every Daikin region or app**.

| App | Markets | Adapters | Client |
| --- | --- | --- | --- |
| DAIKIN Mobile Controller | Thailand, Singapore, the Philippines, Hong Kong, Taiwan, Australia, New Zealand | BRP072A42, BRP072C42, BRP069 | `ClassicDaikinClient` |
| DAIKIN Mobile Controller | The same | BRP084 | `DsiotDaikinClient` |
| Daikin Airbase | Australia | BRP15B61, on a ducted unit | `AirbaseDaikinClient` |
| ONECTA, once Daikin Online Controller | Europe | BRP069A and BRP069B series | `ClassicDaikinClient` |

Each app may be available in more countries than the table lists: if your
local Daikin site points you to one of the three, this package should apply.

Three limits apply, and [UNSUPPORTED.md](UNSUPPORTED.md) says what is not known
about each:

- **Europe**: power, mode, setpoint, fan, swing and special modes go to a
  classic adapter there as they do elsewhere. `getCapabilities()` follows the
  rules of the other markets, and which adapters there speak HTTPS is not
  known.
- **A DSIOT adapter in Europe** (BRP069C series) is not covered: it may not
  answer on the LAN until it is switched on.
- **An Airbase adapter** is told from a classic one by how it answers over
  HTTP: no field of its discovery reply is known to differ.

Units sold for other apps likely use a different protocol, e.g. GO DAIKIN
(Malaysia) or Daikin Comfort Control / Daikin One (North America).

This package is still young, so expect some rough edges. If something doesn't
work with your unit, please
[open an issue](https://github.com/cheziyi/daikin-local-control/issues).
[UNSUPPORTED.md](UNSUPPORTED.md) lists what isn't supported yet.

## Local HTTPS

Only some classic adapters use HTTPS: those reporting `adp_kind=3` with
`en_secure=1`. Discovery sets `device.usesHttps` for them. Every other adapter,
DSIOT included, talks plain HTTP on the LAN, even when it requires registration.

Over HTTPS the adapter presents a certificate issued by Daikin's own CA, which
this package can't ship. So by default **the certificate is not verified**: the
connection is encrypted, but another device on your LAN could impersonate the
adapter. If you have the CA certificate, pass it to turn verification on:

```ts
import { readFileSync } from "node:fs";

const client = createDaikinClient(device, {
  terminalUuid: savedUuid,
  tls: { ca: readFileSync("daikin-ca.pem") },
});
```

With a CA, the certificate chain is verified but the hostname isn't, because the
adapter's certificate doesn't name its LAN address.

## Development

Uses [pnpm](https://pnpm.io) and Node 22.19 or later (see `.nvmrc`; `fnm use` / `nvm use` picks it up).

```bash
pnpm build            # tsc -> dist
pnpm test             # typecheck + vitest
pnpm check            # biome lint + format + import sorting
pnpm fix              # check, applying safe fixes
```

`pnpm install` sets up a [lefthook](https://lefthook.dev) pre-commit hook that runs `pnpm fix` on staged files.

To release, push a tag `vX.Y.Z`, or publish a GitHub release that creates it:
CI sets the version from the tag and publishes to npm.
[AGENTS.md](AGENTS.md#version-the-package-with-semver) says which number to
pick.

## Legal disclaimer

An independent, community project for local interoperability and home automation.
It is not affiliated with, authorized, or endorsed by Daikin Industries, Ltd. All
product names and trademarks are the property of their respective owners; their use
here is for identification and compatibility only.

**Local-only.** The package talks only to the adapter over the LAN — it never contacts
any manufacturer cloud, remote server, or online API — and acts as an ordinary
client of the adapter's own endpoints.

**No proprietary material.** It ships no manufacturer keys, tokens, certificates, or
binaries. The protocol was documented independently, for interoperability.

Provided "as is", without warranty of any kind (see [LICENSE](LICENSE)); use it at
your own risk.

## License

[MIT](LICENSE). Copyright © 2026 the contributors.
