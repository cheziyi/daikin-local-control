# Unsupported

Everything below is left out because its exact request or reply is not known.
To add one, pin down the request and reply first, then delete its row.

## Left out

| Feature | What is unknown | Reach it with |
| --- | --- | --- |
| DSIOT special air outlet | Which leaf reports it. `getCapabilities` reports `specialOutlet: false`. | `DsiotDaikinClient.multireqGet()` |
| Classic `/common/set_location` | The parameter name. | `ClassicDaikinClient.command()` |
| DSIOT `/config/*` endpoints: time zone, date and time, network settings, Wi-Fi scan, firmware update | The request bodies. | Not reachable |
| DSIOT fixed horizontal louver positions | Which position each value 1-14 stands for. `getState` reports `stop` for any of them, and a control that sets `stop` keeps the position. | `DsiotDaikinClient.multireqUpdate()` |
| DSIOT dehumidify setpoint write | Whether `p_1E` accepts a write; it is treated as read-only, so `setState` drops a `targetTemperatureInC` in dehumidify. | `DsiotDaikinClient.multireqUpdate()` |
| Classic `shum_asean`, the humidity setting of a `subtype=qa` unit | What each value stands for. `setState` sends such a unit no humidity setting, and `getCapabilities` lists none. | `ClassicDaikinClient.command()` |
| Classic vertical louver value `f_dir_ud=C` | What it stands for. `getState` reports `null`. | `ClassicDaikinClient.command()` |
| Classic schedule demand mode (`mode=1`) | The full format of the weekly table it needs (`moc`..`suc`, `<day><n>_en`/`_t`/`_p`). | `ClassicDaikinClient.command()` |
| Classic special mode `spmode_kind=4` (heat plus) | Which units take it. | `ClassicDaikinClient.command()` |
| Timers, weekly programs, schedule timers (`/aircon/get_timer`, `set_timer`, `get_program`, `set_program`, `get_scdltimer_info`, `get_scdltimer_body`, `set_scdltimer_info`, `set_scdltimer_body`) | Their parameters. | `ClassicDaikinClient.command()` |
| Classic setting reads: `/aircon/get_demand_control`, `/aircon/get_price`, `/aircon/get_target`, `/common/get_holiday` | The reply fields. | `ClassicDaikinClient.command()` |
| Classic notifications, clock and account: `/common/get_notify`, `set_notify`, `set_push_notice`, `set_timezone`, `notify_date_time`, `set_account` | Their parameters. | `ClassicDaikinClient.command()` |
| Classic network: `/common/get_network_setting`, `set_network_setting`, `start_wifi_scan`, `get_wifi_scan_result`, `start_wifi_connection`, `permit_wifi_connection`, `set_lpw` | Their parameters. | `ClassicDaikinClient.command()` |
| Classic firmware update: a POST to `/dkac/system/fwupdate` | The format of the upload. | Not reachable |

## Not modelled

These values are known, but the package's types don't represent them yet:

| Value | What `getState` reports instead |
| --- | --- |
| Humidify mode (classic `HUM`, DSIOT `0800`) and laundry mode (classic `LND`) | `mode: "auto"`. `setState` keeps the mode unless the control sets one, and on a DSIOT adapter writes power alone while it is kept. |
| DSIOT vertical louver values other than stop, the first five fixed positions, swing, auto, natural wind and floor warming | `verticalPosition: null` |
| DSIOT laundry mode (`dgc_status.e_1002.e_3003.p_25` = `01`) | The mode in `dgc_status.e_1002.e_3001.p_01` |
| Classic `f_dir=6` (heat with the special air outlet) | `swingMode: "off"` |
| Japanese units (`reg=jp`), which follow separate rules for limits, humidity and fan, and take a humidity percentage | The rules for other regions |

These adapter codes pass through a model unchanged, because what each one
stands for is not known:

| Model field | Holds |
| --- | --- |
| `DeviceMetadata.icon` | The `icon` that classic `/common/set_icon` takes |
| `DaikinCapabilities.model` | The classic `model` field, or DSIOT `dgc_status.e_1002.e_A001.p_0D`, such as `0ABB` |
