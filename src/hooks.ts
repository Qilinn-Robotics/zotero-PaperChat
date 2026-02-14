import { initLocale } from "./utils/locale";
import { registerPreferencesPane, waitForZoteroReady } from "./compat/zotero";
import { registerReaderSection } from "./modules/reader";
import { handlePrefsEvent } from "./modules/preferenceScript";
import { config } from "../package.json";

async function onStartup() {
  await waitForZoteroReady();
  initLocale();

  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));

  registerPreferencesPane({
    pluginID: addon.data.config.addonID,
    src: `${rootURI}content/preferences.xhtml`,
    label: "PaperChat",
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });

  registerReaderSection();
}

async function onMainWindowLoad(win: Window) {
  // @ts-ignore - MozXULElement is a firefox/chrome runtime API.
  win.MozXULElement?.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
}

function onShutdown() {
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onMainWindowUnload(_win: Window) {
  ztoolkit.unregisterAll();
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

function onPrefsEvent(type: string, data: { window: Window; [key: string]: any }) {
  handlePrefsEvent(type, data);
}

export default {
  onStartup,
  onMainWindowLoad,
  onShutdown,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
