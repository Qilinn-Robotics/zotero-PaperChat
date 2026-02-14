import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

export interface ActiveAIConfig {
  apiKey: string;
  apiEndpoint: string;
  modelName: string;
  temperature: number;
  systemPrompt: string;
}

export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}

export function getActiveAIConfig(): ActiveAIConfig {
  const rawTemp = Number(getPref("temperature"));
  const temperature = Number.isFinite(rawTemp)
    ? Math.min(2, Math.max(0, rawTemp))
    : 0.7;

  return {
    apiKey: (getPref("apiKey") || "").trim(),
    apiEndpoint: (getPref("apiEndpoint") || "").trim(),
    modelName: (getPref("modelName") || "gpt-4o-mini").trim(),
    temperature,
    systemPrompt:
      (getPref("systemPrompt") ||
        "You are a helpful assistant for reading and analysis.").trim(),
  };
}
