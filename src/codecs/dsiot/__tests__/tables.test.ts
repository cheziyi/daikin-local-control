import { describe, expect, it } from "vitest";
import * as tables from "../tables.js";

// The codecs and the simulators read each leaf and code from one table, so a
// wrong one would be wrong on both sides and they would still agree. Each
// table is written out a second time here.
describe("the DSIOT tables", () => {
  it("hold every resource, leaf and code as an adapter does", () => {
    const mode = (name: string) => `dgc_status.e_1002.e_3001.${name}`;

    expect({ ...tables }).toEqual({
      DSIOT_OPERATIONS: { get: 2, update: 3, delete: 4 },
      DSIOT_EDGES: { indoor: "adr_0100", outdoor: "adr_0200" },
      DSIOT_EDGE_ROOT: "/dsiot/edge",
      DSIOT_TARGETS: {
        adapterInfo: "/dsiot/edge.adp_i?filter=pv",
        adapterSettings: "/dsiot/edge.adp_d?filter=pv",
        indoorStatus: "/dsiot/edge/adr_0100.dgc_status?filter=pv,pt,md",
        outdoorStatus: "/dsiot/edge/adr_0200.dgc_status?filter=pv,pt,md",
      },
      DSIOT_ADAPTER_TYPE: "GPF",
      DSIOT_AIR_CLEANER_DEVICES: ["1D", "CJ"],
      DSIOT_ADAPTER_PATHS: {
        name: "adp_d.name",
        macAddress: "adp_i.mac",
        firmwareVersion: "adp_i.ver",
        region: "adp_i.reg",
        kind: "adp_i.kind",
        energyMonitoring: "adp_i.func.en_ipower",
        demandControl: "adp_i.func.en_demand",
        scheduleTimer: "adp_i.func.en_scdltmr",
      },
      DSIOT_PATHS: {
        power: "dgc_status.e_1002.e_A002.p_01",
        powerTransition: "dgc_status.e_1002.e_3003.p_2D",
        mode: "dgc_status.e_1002.e_3001.p_01",
        indoorTemperature: "dgc_status.e_1002.e_A00B.p_01",
        indoorHumidity: "dgc_status.e_1002.e_A00B.p_02",
        outdoorTemperature: "dgc_status.e_1003.e_A00D.p_01",
        model: "dgc_status.e_1002.e_A001.p_0D",
        modelType: "dgc_status.e_1002.e_A001.p_07",
        energyMonitoring: "dgc_status.e_1002.e_A011.p_01",
      },
      DSIOT_ON: "01",
      DSIOT_OFF: "00",
      DSIOT_COOLING_ONLY_MODEL_TYPE: "01",
      DSIOT_HEAT_PUMP_MODEL_TYPE: "00",
      DSIOT_LOCAL_PASSWORD_HEADER: "Authorization",
      DSIOT_LOCAL_PASSWORD_SCHEME: "Basic",
      DSIOT_SPECIAL_MODE_PATHS: {
        powerful: "dgc_status.e_1003.e_3002.p_44",
        econo: "dgc_status.e_1002.e_3003.p_24",
        streamer: "dgc_status.e_1002.e_3003.p_20",
      },
      DSIOT_MODE_NODE: "dgc_status.e_1002.e_3001",
      DSIOT_MODE_PATHS: {
        auto: {
          setpoint: { path: mode("p_1D"), signed: true, writable: true },
          humidity: { value: mode("p_2E"), flag: mode("p_2F") },
          fanSpeed: mode("p_26"),
          vertical: mode("p_20"),
          horizontal: mode("p_21"),
        },
        dehumidify: {
          setpoint: { path: mode("p_1E"), signed: true, writable: false },
          humidity: { value: mode("p_30"), flag: mode("p_31") },
          fanSpeed: mode("p_27"),
          vertical: mode("p_22"),
          horizontal: mode("p_23"),
        },
        cool: {
          setpoint: { path: mode("p_02"), signed: false, writable: true },
          humidity: { value: mode("p_0B"), flag: mode("p_0C") },
          fanSpeed: mode("p_09"),
          vertical: mode("p_05"),
          horizontal: mode("p_06"),
        },
        heat: {
          setpoint: { path: mode("p_03"), signed: false, writable: true },
          humidity: { value: mode("p_2C"), flag: mode("p_2D") },
          fanSpeed: mode("p_0A"),
          vertical: mode("p_07"),
          horizontal: mode("p_08"),
        },
        fan: {
          fanSpeed: mode("p_28"),
          vertical: mode("p_24"),
          horizontal: mode("p_25"),
        },
      },
      DSIOT_OPERATING_MODE_CODES: {
        fan: "0000",
        heat: "0100",
        cool: "0200",
        auto: "0300",
        dehumidify: "0500",
      },
      DSIOT_OPERATING_MODE_ALIASES: { "0900": "cool", "0A00": "heat" },
      DSIOT_POWER_TRANSITION_CODES: {
        turningOn: "00",
        turningOff: "01",
        unchanged: "02",
      },
      DSIOT_FAN_SPEED_CODES: {
        auto: "0A00",
        silent: "0B00",
        level1: "0300",
        level2: "0400",
        level3: "0500",
        level4: "0600",
        level5: "0700",
      },
      DSIOT_LOUVER_VALUES: {
        stop: 0,
        swing: 15,
        auto: 16,
        naturalWind: 19,
        floorWarming: 25,
      },
      DSIOT_FIXED_LOUVER_VALUES: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
      ],
      DSIOT_LOUVER_STOP: "000000",
      DSIOT_LOUVER_SWING: "0F0000",
      DSIOT_VERTICAL_POSITION_VALUES: {
        stop: 0,
        swing: 15,
        naturalWind: 19,
        auto: 16,
        floorWarming: 25,
      },
      DSIOT_HORIZONTAL_POSITION_VALUES: { swing: 15, auto: 16 },
      DSIOT_HUMIDITY_OFF: "00",
      DSIOT_HUMIDITY_PERCENTAGE: "01",
      DSIOT_HUMIDITY_OFF_KEPT: "05",
      DSIOT_HUMIDITY_SETTING_FLAGS: {
        auto: "02",
        autoHigh: "03",
        autoLow: "04",
        continuous: "06",
      },
    });
  });
});
