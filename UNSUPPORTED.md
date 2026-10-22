# Unsupported

Everything below is left out because its exact request or reply is not known.
To add one, pin down the request and reply first, then delete its row.

## Left out

| Feature | What is unknown | Reach it with |
| --- | --- | --- |
| Classic `/common/set_location` | The parameter name. | `ClassicDaikinClient.command()` |
| DSIOT `/config/*` endpoints: time zone, date and time, network settings, Wi-Fi scan, firmware update | The request bodies. | Not reachable |
| DSIOT fixed horizontal louver positions | Which position each value 1-14 stands for. `getState` reports `stop` for any of them, and a control that sets `stop` keeps the position. | `DsiotDaikinClient.multireqUpdate()` |
| DSIOT dehumidify setpoint write | Whether `p_1E` accepts a write; it is treated as read-only, so `setState` drops a `targetTemperatureInC` in dehumidify. | `DsiotDaikinClient.multireqUpdate()` |
| Classic schedule demand mode (`mode=1`) | The full format of the weekly table it needs (`moc`..`suc`, `<day><n>_en`/`_t`/`_p`). | `ClassicDaikinClient.command()` |
| Timers, weekly programs, schedule timers (`/aircon/get_timer`, `set_timer`, `get_program`, `set_program`, `get_scdltimer_info`, `get_scdltimer_body`, `set_scdltimer_info`, `set_scdltimer_body`) | Their parameters. | `ClassicDaikinClient.command()` |
| Energy history: classic `/aircon/get_week_power`, `get_year_power`, `get_day_power_ex`, `get_week_power_ex`, `get_year_power_ex`, and DSIOT `adr_0100.i_power.week_power`, `year_power`, `month_power_ex` and `year_power_ex` | The unit of each value, and which day or month each position in a list stands for. | `ClassicDaikinClient.command()`, `DsiotDaikinClient.multireqGet()` |
| Power draw: classic `mompow` in `/aircon/get_sensor_info`, DSIOT `dgc_status.e_1003.e_A005.p_01` | The unit. | `ClassicDaikinClient.command()`, `DsiotDaikinClient.multireqGet()` |
| Compressor frequency: classic `cmpfreq` in `/aircon/get_sensor_info`, DSIOT `dgc_status.e_1003.e_2006.p_04` | The unit. | `ClassicDaikinClient.command()`, `DsiotDaikinClient.multireqGet()` |
| Error code: classic `err` in `/aircon/get_sensor_info` and `/common/basic_info` | Which code on the unit's display each number stands for. | `ClassicDaikinClient.command()` |
| Reading the settings of a DSIOT adapter: LED, holiday mode, icon, group | The value encoding of each `adp_d` leaf. | `DsiotDaikinClient.multireqGet()` |
| Classic `powerful` and `econo` on a unit whose `cpv` is not 3, or whose `cpv_minor` is `00` or missing | Whether such a unit takes them. `getCapabilities` lists neither for it, whatever its `en_spmode`. | `ClassicDaikinClient.setSpecialMode()` |
| `econo` in fan mode | Whether a unit takes it. `getCapabilities` lists it in every mode but fan. | `DaikinClient.setSpecialMode()` |
| A special mode switched on while another is on | Whether the adapter switches the other off. `setSpecialMode` writes the one mode it is given. | `DaikinClient.setSpecialMode()` |
| Classic notifications, clock and account: `/common/get_notify`, `set_notify`, `set_push_notice`, `set_timezone`, `notify_date_time`, `set_account` | Their parameters. | `ClassicDaikinClient.command()` |
| Classic network: `/common/get_network_setting`, `set_network_setting`, `start_wifi_scan`, `get_wifi_scan_result`, `start_wifi_connection`, `permit_wifi_connection`, `set_lpw` | Their parameters. | `ClassicDaikinClient.command()` |
| Classic firmware update: a POST to `/dkac/system/fwupdate` | The format of the upload. | Not reachable |
| A terminal uuid in another form: with dashes, uppercase, or not 32 hexadecimal digits | Whether the adapter accepts it. `createDaikinClient` throws an `Error` for one. | Not reachable |
| Telling an Airbase adapter from a classic one in a discovery reply | Whether any field of the reply differs: both report `type=aircon`. `discoverDevices` asks the adapter over HTTP instead, and takes HTTP 404 at `/common/basic_info` with `ret=OK` at `/skyfi/common/basic_info` for an Airbase adapter. What a classic adapter answers under `/skyfi` is not known, so it is never asked there. | Set `protocol` on the `DaikinDevice` by hand |
| An Airbase child lock: `lpw_flag` in its `/common/basic_info` | Whether an Airbase adapter has a child lock code, and how a request would carry one. `discoverDevices` reports `requiresLocalPassword: false` for an Airbase adapter whatever its `lpw_flag`, and `AirbaseDaikinClient` sends no `lpw`. | `AirbaseDaikinClient.command()` |
| Airbase special modes | Whether a unit takes any, and the request. `getState` reports none, and `AirbaseDaikinClient.setSpecialMode` rejects with status 501. | `AirbaseDaikinClient.command()` |
| Airbase humidity: `shum` in `/aircon/get_control_info`, with each mode's own in `dh1` (auto), `dh2` (dehumidify), `dh3` (cool), `dh4` (heat) and `dhh`, in the classic encoding | Whether a ducted unit has a humidity setting. `getState` reports `null`, and `setState` sends `shum` back as the unit holds it and none of the `dh` fields. | `AirbaseDaikinClient.command()` |
| Airbase energy monitoring and demand control | Which field says a unit has energy monitoring, and whether `en_demand` in `/aircon/get_control_info` says a unit has demand control or that it is on. `getCapabilities` reports `false` for both. | `AirbaseDaikinClient.command()` |
| Airbase `f_dir` values 5 and 6 | What each stands for: a unit takes 0 to 4 and 7. `getState` reports `verticalPosition: null`. | `AirbaseDaikinClient.command()` |
| Airbase `operate` in `/aircon/get_control_info`, on a unit in auto, fan or dehumidify | Whether it names the mode such a unit runs on, in which encoding. `setState` runs those modes on the one `bk_auto` names. | `AirbaseDaikinClient.command()` |
| Airbase `/aircon/set_control_info` without `dt0` to `dt7` | Whether the adapter takes it, so `setState` sends the target mode's. It takes a write without `dfr1`, `dfr2`, `dfd1`, `dfd2`, `auto1`, `auto2`, `airside1` and `airside2`, which `setState` sends only for a control that changes them. | `AirbaseDaikinClient.command()` |
| Every other Airbase endpoint: timers, programs, schedules, holiday, demand control, energy history, network and firmware | Their parameters and reply fields. | `AirbaseDaikinClient.command()` |
| A classic adapter sold in Europe: the capability fields of a unit there (`reg=eu`) | Whether such a unit reports them as a unit in the other markets does. `getCapabilities` reads them by the same rules. | `ClassicDaikinClient.command()` |
| A classic adapter sold in Europe that reports `adp_kind=3` and `en_secure=1` | Whether it speaks HTTPS, as such an adapter does in the other markets. `discoverDevices` sets `usesHttps` for it. | Set `usesHttps: false` on the `DaikinDevice` |
| A DSIOT adapter sold in Europe (BRP069C series) | Whether its `dgc_status` leaves hold the values a BRP084 holds. Its `adp_i`, `adp_d` and `dgc_status` resources are read with the same request. | `DsiotDaikinClient.multireqGet()` |
| A DSIOT adapter that answers `/dsiot/multireq` only once it is switched on, by the UDP datagram `DAIKIN_UDP/debug/en_multireq 1` sent to its port 30050 | Which adapters need it, what one answers to the datagram and to `/dsiot/multireq` before it, and how long it stays on. | Not reachable |
| An adapter whose discovery reply has a `type` other than `aircon` and `GPF`, such as `common_adp`, or none, or `type=GPF` with a `cdev` other than `RA` and `NA` | Whether any is an air conditioner's. `discoverDevices` leaves it out. | Write the `DaikinDevice` by hand |

## Not modelled

These values are known, but the package's types don't represent them yet:

| Value | What `getState` reports instead |
| --- | --- |
| Humidify mode (classic `HUM`, DSIOT `0800`) and laundry mode (classic `LND`) | `mode: "auto"`. `setState` keeps the mode unless the control sets one, and on a DSIOT adapter writes power alone while it is kept. |
| DSIOT vertical louver values other than stop, the first five fixed positions, swing, auto, natural wind, floor warming and circulating airflow | `verticalPosition: null` |
| DSIOT laundry mode (`dgc_status.e_1002.e_3003.p_25` = `01`) | The mode in `dgc_status.e_1002.e_3001.p_01` |
| Classic `f_dir=6`, the vertical louver at floor warming, on a unit without `f_dir_ud` | `swingMode: "off"` and `verticalPosition: null`. A 3D unit reports `floorWarming` from `f_dir_ud`, and `setState` writes `f_dir=6` with it |
| Classic `shum_asean`, the humidity setting of a `subtype=qa` unit: 0 for off and 1 to 3 for a level, taken in cool, with `s_humd_asean` bits 1, 2, 4 and 8 for the values a unit takes | `targetHumidity: null`. `setState` sends such a unit no humidity setting, and `getCapabilities` lists none |
| Japanese units (`reg=jp`), which follow separate rules for limits, humidity and fan, and take a humidity percentage | The rules for other regions |
| Airbase zone temperatures: `lztemp_c` and `lztemp_h` in `/aircon/get_zone_setting`, a setpoint for each zone in cool and in heat on a unit with `en_linear_zone=1` | Nothing: `getZones` leaves them out, and `setZone` sends the running mode's back as the unit holds them |
| Airbase fan auto and airside | `fanSpeed` holds `f_rate` alone. `AirbaseDaikinClient.getFanAuto` and `getAirside` report the other two |
| Airbase modes outside `OperatingMode`, such as `HUM` | `mode: "auto"`. `setState` keeps the mode unless the control sets one |

These adapter codes pass through a model unchanged, because what each one
stands for is not known:

| Model field | Holds |
| --- | --- |
| `DeviceMetadata.icon` | The `icon` that classic `/common/set_icon` takes |
| `DaikinCapabilities.model` | The classic `model` field, or DSIOT `dgc_status.e_1002.e_A001.p_0D`, such as `0ABB` |

## Simulators

`startClassicSimulator`, `startDsiotSimulator` and `startAirbaseSimulator`
answer HTTP 501 to every request this table leaves them without an answer
for:

| Left out | What is unknown |
| --- | --- |
| A classic endpoint without a typed method on `ClassicDaikinClient`, and any method but GET | The reply fields. |
| Classic `/common/register_terminal` on an adapter started without a `key` | What an adapter that requires no registration answers. |
| A DSIOT resource other than `adp_i`, `adp_d` and the `dgc_status` of the indoor and the outdoor unit | The leaves and their encodings. |
| A DSIOT read of a node below a resource, a read with a query other than `filter`, and a write that names a leaf the adapter does not report | What an adapter answers. |
| A `/dsiot/multireq` body that is not JSON, has no `requests`, or carries an `op` other than 2 in a POST and 3 in a PUT | What an adapter answers. |
| `setState` on a DSIOT simulator with a humidity percentage, or a fixed horizontal louver position: it throws an `Error` | The step a percentage is counted in, and which value each position is. Set the leaf in `leaves`. |
| HTTPS | The certificate an adapter presents is issued by Daikin's own CA. A simulator started with a `key` reports `adp_kind=4`, an adapter that registers terminals over HTTP. |
| An Airbase endpoint without a typed method on `AirbaseDaikinClient`, and any method but GET | The reply fields. |
| Airbase `/aircon/get_zone_setting` and `set_zone_setting` on a unit without zones | What such a unit answers. |

These answers are a simulator's own choice, where an adapter's is not known:

| A simulator | What is unknown |
| --- | --- |
| Answers HTTP 403 to a terminal that is not registered, `/common/basic_info` included, and to `/common/register_terminal` with the wrong key | Which of HTTP 401 and 403 an adapter answers, which endpoints it answers before registration, and what it answers to a wrong key. |
| Answers `ret=LPW NG` to every classic endpoint without the right `lpw` | Which endpoints an adapter answers without it. |
| Answers `rsc` 4001, with HTTP 200, to a DSIOT request without the right `Authorization` | Whether an adapter answers that or HTTP 401. |
| Answers `ret=PARAM NG` to a classic write without a parameter, or with a `spmode_kind` other than 1, 2 and 4. `/aircon/set_control_info` needs `pow`, `mode`, `stemp`, `f_rate` and, on a unit that reports it, `shum` | Which requests an adapter answers `PARAM NG`, and whether it takes a `set_control_info` without one of them. |
| Holds any value it is sent or set to, and a special mode the unit does not report taking | What an adapter answers to a value the unit does not take. |
| Drops a `/aircon/set_control_info` parameter that is not a control field or the `dt`, `dh`, `dfd` or `ndfd` of a mode | Which other parameters an adapter takes. |
| Answers every reply's fields in one order, with no field beyond those it holds | The order of an adapter's fields, and the fields no caller of this package reads. |
| Keeps answering after `/common/reboot` and `/config/system/reboot` | How long an adapter stays away. |
| Answers `rsc` 2000 to a DSIOT read and 2004 to a write, without `fr`, and without `pc` on a write | Which `rsc` from 2000 to 2004 an adapter answers each with, and what else the reply carries. |
| Sends a leaf's `pn` and `pt` whatever a read's `filter` lists, its `pv` and `md` when the filter lists them, and all four without a filter | What an adapter sends for a filter other than `pv`, `pv,md` and `pv,pt,md`. |
| Sends `b` as the `pt` inside each `md`, and gives a leaf `pt` 2 where a write is known for it and 3 otherwise | What `md.pt` holds, and what tells `pt` 2 from 3 beyond a special mode's leaf. |
| Leaves every other leaf as it is when one is written: switching powerful on leaves econo on | Which leaves a DSIOT adapter changes on its own. |
| Holds `--` as the `stemp` and `shum` of a classic mode without a `dt` or a `dh`, when `setState` changes to it | What a unit holds in fan mode after a change on its remote control. |
| Still answers `f_dir` in `/aircon/get_control_info` on a classic simulator started with a `unit` whose `swing` is `none` | Whether a classic unit without a louver reports the field. |
| Makes a request wait while it answers another | Whether an adapter also drops a connection while it is busy. |
| Answers a discovery probe from UDP port 30050 of its address | The port an adapter answers from. |
| Answers HTTP 404 to every path outside `/skyfi`, on an Airbase simulator | Which paths besides `/common/basic_info` an Airbase adapter answers 404. |
| Answers `ret=PARAM NG` to an Airbase `/aircon/set_control_info` without `pow`, `mode`, `stemp`, `shum`, `f_rate`, `f_auto`, `f_airside` or `f_dir`, and to a `set_zone_setting` without `zone_name` or `zone_onoff` | Which requests an Airbase adapter answers `PARAM NG`, and whether it takes a write without one of them. |
| Keeps what an Airbase unit remembers for cool or for heat equal to what it holds, and names that mode in `bk_auto` once the unit is set to it | What an Airbase unit remembers on its own, and when it changes `bk_auto`. |
| Reports no `shum`, no `adp_kind` and no `adv` on an Airbase simulator, and `model=NOTSUPPORT` | Which of them an Airbase adapter reports, and what its `model` holds on each unit. |
| Holds the lists of an Airbase `get_zone_setting` with `%3B` for each `;`, and as many names as the unit has zones | The letter case an adapter sends, and whether it names more zones than `en_zone` counts. |
