import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

const endpointPattern = /^https?:\/\/.+/i;

export function registerPrefsScripts(win: Window) {
  const doc = win.document as Document;

  const apiKeyInput = doc.getElementById(
    `pref-${config.addonRef}-apiKey`,
  ) as HTMLInputElement;
  const endpointInput = doc.getElementById(
    `pref-${config.addonRef}-apiEndpoint`,
  ) as HTMLInputElement;
  const modelInput = doc.getElementById(
    `pref-${config.addonRef}-modelName`,
  ) as HTMLInputElement;
  const tempInput = doc.getElementById(
    `pref-${config.addonRef}-temperature`,
  ) as HTMLInputElement;
  const promptInput = doc.getElementById(
    `pref-${config.addonRef}-systemPrompt`,
  ) as HTMLTextAreaElement;
  const saveButton = doc.getElementById("paperchat-save-config") as HTMLButtonElement;
  const statusText = doc.getElementById("paperchat-save-status") as HTMLDivElement;

  apiKeyInput.value = (getPref("apiKey") || "") as string;
  endpointInput.value =
    (getPref("apiEndpoint") as string) ||
    "https://api.openai.com/v1/chat/completions";
  modelInput.value = (getPref("modelName") as string) || "gpt-4o-mini";
  tempInput.value = String((getPref("temperature") as number) ?? 1);
  promptInput.value =
    (getPref("systemPrompt") as string) ||
    "You are a helpful assistant for reading and analysis.";

  saveButton.onclick = () => {
    const endpoint = endpointInput.value.trim();
    const temperature = Number(tempInput.value);

    if (!endpointPattern.test(endpoint)) {
      statusText.textContent = "API Endpoint 必须是 http(s) 地址";
      statusText.className = "paperchat-pref-status paperchat-pref-status-error";
      return;
    }
    if (!endpoint.includes("/chat/completions")) {
      statusText.textContent =
        "API Endpoint 需为完整 chat completions 地址（包含 /chat/completions）";
      statusText.className = "paperchat-pref-status paperchat-pref-status-error";
      return;
    }

    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      statusText.textContent = "Temperature 必须在 0 到 2 之间";
      statusText.className = "paperchat-pref-status paperchat-pref-status-error";
      return;
    }

    setPref("apiKey", apiKeyInput.value.trim());
    setPref("apiEndpoint", endpoint);
    setPref("modelName", modelInput.value.trim() || "gpt-4o-mini");
    setPref("temperature", temperature);
    setPref("systemPrompt", promptInput.value.trim());

    statusText.textContent = "配置已保存，立即生效";
    statusText.className = "paperchat-pref-status paperchat-pref-status-ok";
  };
}

export function handlePrefsEvent(type: string, data: { window: Window }) {
  if (type === "load") {
    registerPrefsScripts(data.window);
  }
}
