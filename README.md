# daikin-local-control

[![npm version](https://img.shields.io/npm/v/daikin-local-control)](https://www.npmjs.com/package/daikin-local-control)
[![CI](https://github.com/cheziyi/daikin-local-control/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cheziyi/daikin-local-control/actions/workflows/ci.yml?query=branch%3Amain)
[![Node version](https://img.shields.io/node/v/daikin-local-control)](package.json)
[![License](https://img.shields.io/npm/l/daikin-local-control)](LICENSE)

A TypeScript and Node.js client for controlling Daikin air conditioners **over
the local network** (LAN), through their Wi-Fi adapters and with no cloud
dependency. It implements the same local-control protocol as the **DAIKIN Mobile
Controller** app, so it works with the units and Wi-Fi adapters that app
supports — split / multi-split and SkyAir units fitted with adapters such as the
BRP072A42, BRP072C42 and BRP084 — in the
[markets where that app is used](#coverage--limitations).

Daikin Wi-Fi adapters come in two generations, and the package has a client for
each:

- **`ClassicDaikinClient`** — classic adapters (BRP072A42, BRP072C42, BRP069).
  Full core control plus typed [extended controls](#extended-controls).
- **`DsiotDaikinClient`** — newer DSIOT adapters (BRP084). Power, mode,
  setpoint, humidity, fan, swing and louver positions;
  [UNSUPPORTED.md](UNSUPPORTED.md) lists what is not mapped yet.

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

// 2. Build the right client: createDaikinClient picks the classic or the DSIOT
//    client from the device. Pass localPassword only when the adapter has a
//    child lock code (see Credentials below).
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

`discoverDevices()` resolves with one `DaikinDevice` for each adapter that
answered, and with an empty array when none did. Each carries the adapter's
`macAddress`, such as `A4:08:EA:CC:91:D4`, and `firmwareVersion`, such as
`1.2.51`, when the adapter reports them: key a stored device on `macAddress`,
because `host` changes when the adapter is given a new address.

| It | So |
| --- | --- |
| Resolves after `timeoutInMs`, never earlier | Pass `discoverDevices({ timeoutInMs: 1000 })` to wait less than the default 3000 |
| Broadcasts to `255.255.255.255` | It does not find an adapter on another subnet or VLAN |
| Binds UDP port 30000 | It rejects with the socket's error when the socket fails |

Write the device by hand when you already know its address, or when discovery
cannot reach it:

```ts
import { createDaikinClient, type DaikinDevice } from "daikin-local-control";

const device: DaikinDevice = { host: "192.168.1.50", protocol: "classic" };
const client = createDaikinClient(device, { terminalUuid: savedUuid });
```

A device written by hand has no `macAddress` or `firmwareVersion`: read them
from the adapter with `await client.getDeviceInfo()`.

Set `protocol` to `dsiot` for a BRP084 and to `classic` for every other
adapter. A device without flags is an adapter that requires neither
registration nor a child lock code. If yours requires either, set
`requiresRegistration: true` / `requiresLocalPassword: true` and set up
[credentials](#credentials) to match; add `usesHttps: true` if it also speaks
HTTPS. The flags are independent, and discovery reads them all from the adapter
for you.

### Credentials

An adapter can need up to three things. Discovery tells you which ones apply
(`device.requiresRegistration`, `device.requiresLocalPassword`).

**Terminal uuid (always).** It identifies your app to the adapter. Any random
UUID works. Generate it **once**, store it, and reuse it on every run: an
adapter that requires registration remembers it, so a new uuid means registering
again.

```ts
import { randomUUID } from "node:crypto";

const savedUuid = loadFromConfiguration() ?? saveToConfiguration(randomUUID());
```

**KEY (when `device.requiresRegistration` is `true`).** These
adapters only answer terminals they have registered. Each adapter's KEY is
printed on its label, next to the SSID (also in the operation manual). Register
your uuid with it once. Until you do, every call fails with HTTP 401/403.
Each uuid is registered separately, so an adapter already set up in the DAIKIN
Mobile Controller app still needs registering here.

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
in the DAIKIN Mobile Controller app. It is **not** printed on the label, and it
is not your Wi-Fi or Out-of-Home password. Pass it as `localPassword` to
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
| `specialModes` | The special modes the unit takes, empty when it reports none |
| `specialOutlet`, `energyMonitoring`, `demandControl`, `scheduleTimer` | `true` when the unit has the feature |
| `model` | The adapter's own code for the unit's model |

`getSensors()` resolves with `indoorTemperatureInC`, `outdoorTemperatureInC`
and `indoorHumidityInPercent`, each `null` when the unit does not report it.

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
| `verticalPosition`, `horizontalPosition` | On a classic adapter, when the unit has no 3D airflow. On a DSIOT adapter, a fixed vertical position the unit lacks, and every fixed horizontal position |

`setState()` takes no `specialModes`: turn one on or off with
[`setSpecialMode()`](#extended-controls), which only a classic adapter has.

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
  await client.setSpecialMode("powerful", true);
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
| `getLed()`, `getHolidayMode()` | `true` or `false`, or `null` when the adapter does not report it |
| `getOutOfHomeAccess()` | `true` or `false` |
| `getEnergyPrice()`, `getEnergyTarget()` | A number, or `null` when the adapter does not report it |
| `getMetadata()` | `{ name, icon, group }`, without the fields the adapter does not report |

[UNSUPPORTED.md](UNSUPPORTED.md) lists the endpoints without a typed method and
what is not known about each.

`DsiotDaikinClient` has `reboot()` and the raw `multireqGet` / `multireqUpdate`
hatches for any `dgc_status` leaf.

### Errors and retries

A client method that fails rejects with a `DaikinError`; branch on
`httpStatusCode`:

| `httpStatusCode` | Meaning |
| --- | --- |
| 401 | The adapter rejected the credentials: `ret=AUTH NG` or `LPW NG`, or DSIOT `rsc` 401 or 4001 |
| 502 | The adapter answered with an error: a `ret` or `rsc` other than OK, or a reply that does not parse |
| 503 | The adapter refused or dropped the connection (a `DaikinConnectionError`), or DSIOT answered `rsc` 503 |
| 504 | The request timed out, or the TLS handshake failed |
| Any other | The adapter's own HTTP status, such as 403 |

Two failures are not a `DaikinError`: `discoverDevices()` rejects with the
socket's error, and `multireqUpdate()` throws an `Error` for a path that names
a resource without a leaf, such as `dgc_status`.

Only a `DaikinConnectionError` is retried, up to five times by default.
[DESIGN.md](DESIGN.md#retries) says why.

| To | Pass |
| --- | --- |
| Change how often and how long a client retries | `retry: { delaysInMs: [0, 500] }` to `createDaikinClient`: one wait, in milliseconds, before each retry |
| Stop a client retrying | `retry: { delaysInMs: [] }` to `createDaikinClient` |
| Send one request that is not safe to repeat | `{ retry: false }` as the last argument of `command()`, `multireqGet()` or `multireqUpdate()` |

## Coverage & limitations

It supports the same markets and Wi-Fi adapters as the DAIKIN Mobile Controller
app, so it is **not valid for every Daikin region or app**.

| Region         | Markets using the DAIKIN Mobile Controller app                 |
| -------------- | -------------------------------------------------------------- |
| Southeast Asia | Thailand, Singapore, the Philippines                           |
| East Asia      | Hong Kong, Taiwan                                              |
| Oceania        | Australia, New Zealand                                         |

The app is published by Daikin Thailand and may be available in other countries
too; if your local Daikin site points you to it, this package should apply. Units
sold for other apps likely use a different protocol, e.g. Onecta / Daikin Online
Controller (Europe), GO DAIKIN (Malaysia) or Daikin Comfort Control / Daikin One
(North America).

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
