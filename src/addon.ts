import { config } from "../package.json";
import { DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import * as prefsUtils from "./utils/prefs";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    dialog?: DialogHelper;
  };
  public hooks: typeof hooks;
  public api: {
    getPref: typeof prefsUtils.getPref;
    setPref: typeof prefsUtils.setPref;
    clearPref: typeof prefsUtils.clearPref;
    getActiveAIConfig: typeof prefsUtils.getActiveAIConfig;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {
      getPref: prefsUtils.getPref,
      setPref: prefsUtils.setPref,
      clearPref: prefsUtils.clearPref,
      getActiveAIConfig: prefsUtils.getActiveAIConfig,
    };
  }
}

export default Addon;
