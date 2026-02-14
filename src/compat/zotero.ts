export type ReaderSectionOptions = any;

export interface PreferencesPaneOptions {
  pluginID: string;
  src: string;
  label: string;
  image?: string;
}

export async function waitForZoteroReady() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
}

export function registerPreferencesPane(options: PreferencesPaneOptions) {
  if (!Zotero.PreferencePanes?.register) {
    Zotero.debug("PaperChat: PreferencePanes.register is unavailable.");
    return false;
  }

  Zotero.PreferencePanes.register(options as any);
  return true;
}

export function registerReaderSidebar(options: ReaderSectionOptions) {
  if (!Zotero.ItemPaneManager?.registerSection) {
    Zotero.debug("PaperChat: ItemPaneManager.registerSection is unavailable.");
    return false;
  }

  Zotero.ItemPaneManager.registerSection(options as any);
  return true;
}

export function isReaderContext(tabType: string) {
  return tabType === "reader" || tabType === "library";
}
