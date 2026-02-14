import { getLocaleID } from "../utils/locale";
import { isReaderContext, registerReaderSidebar } from "../compat/zotero";
import * as chatUI from "./chatUI";
import * as chatLogic from "./chatLogic";

const STYLE_ID = "paperchat-zoteropane-style";
const KATEX_STYLE_ID = "paperchat-katex-style";

function ensureStyleSheet(doc: Document) {
  const mountTarget = doc.head || doc.documentElement || doc.body;
  if (!mountTarget) {
    Zotero.debug("PaperChat: failed to mount stylesheet link.");
    return;
  }

  if (!doc.getElementById(STYLE_ID)) {
    const link = doc.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`;
    mountTarget.appendChild(link);
  }

  if (!doc.getElementById(KATEX_STYLE_ID)) {
    const katexLink = doc.createElement("link");
    katexLink.id = KATEX_STYLE_ID;
    katexLink.rel = "stylesheet";
    katexLink.type = "text/css";
    katexLink.href = `chrome://${addon.data.config.addonRef}/content/katex.min.css`;
    mountTarget.appendChild(katexLink);
  }
}

export function registerReaderSection() {
  const ok = registerReaderSidebar({
    paneID: "paperchat-sidebar",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-section-paperchat-head-text"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/icon.png`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-paperchat-sidenav-tooltip"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/icon.png`,
    },
    onRender: ({ body, item }: { body: HTMLElement; item: any }) => {
      const doc = body.ownerDocument;
      if (!doc) {
        return;
      }

      ensureStyleSheet(doc);
      while (body.firstChild) {
        body.removeChild(body.firstChild);
      }
      body.style.width = "100%";
      body.style.maxWidth = "100%";
      body.style.overflow = "hidden";
      body.style.boxSizing = "border-box";

      const ui = chatUI.createChatInterface(body);
      chatLogic.initChat(ui, item);
    },
    onItemChange: ({
      tabType,
      setEnabled,
    }: {
      tabType: string;
      setEnabled: (enabled: boolean) => void;
    }) => {
      setEnabled(isReaderContext(tabType));
      return true;
    },
    onDestroy: () => {
      chatLogic.dispose();
    },
  } as any);

  if (!ok) {
    Zotero.debug("PaperChat: failed to register reader sidebar.");
  }
}
