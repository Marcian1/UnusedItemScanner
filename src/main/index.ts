import { ComponentContext, IComponent, getStudioProApi } from "@mendix/extensions-api";
import type { Push, Request, Response } from "../shared/protocol";
import { runDelete } from "./deleter";
import { listModules, runScan } from "./scanner";

export const component: IComponent = {
    async loaded(componentContext: ComponentContext) {
        if (componentContext.runMode === "headless") {
            return;
        }

        const studioPro = getStudioProApi(componentContext);
        const messaging = studioPro.ui.messagePassing;

        await studioPro.ui.extensionsMenu.add({
            menuId: "UnusedItemScanner.MainMenu",
            caption: "Unused Item Scanner",
            subMenus: [
                {
                    menuId: "UnusedItemScanner.ShowMenu",
                    caption: "Scan for unused items",
                    action: async () => {
                        await studioPro.ui.tabs.open(
                            { title: "Unused Item Scanner" },
                            { componentName: "extension/UnusedItemScanner", uiEntrypoint: "tab" },
                            { isSingleton: true }
                        );
                    }
                }
            ]
        });

        const push = (message: Push) => messaging.sendMessage<Push, never>(message);
        const reply = (messageId: string, response: Response) => messaging.sendResponse(messageId, response);

        let busy: "scan" | "delete" | undefined;
        let cancelRequested = false;

        await messaging.addMessageHandler<Request>(async ({ messageId, message }) => {
            switch (message.type) {
                case "getModules": {
                    try {
                        await reply(messageId, { type: "modules", modules: await listModules(studioPro) });
                    } catch (e) {
                        console.error("[UnusedItemScanner] getModules failed", e);
                        await reply(messageId, { type: "modules", modules: [] });
                    }
                    return;
                }

                case "scan": {
                    if (busy) {
                        await reply(messageId, { type: "ack", ok: false, error: `A ${busy} is already running.` });
                        return;
                    }
                    busy = "scan";
                    cancelRequested = false;
                    await reply(messageId, { type: "ack", ok: true });
                    // Not awaited: the handler returns immediately, progress is pushed to the UI.
                    void runScan(
                        studioPro,
                        message.options,
                        (phase, done, total) => void push({ type: "scanProgress", phase, done, total }),
                        () => cancelRequested
                    )
                        .then((result) => push(result))
                        .catch((e) => {
                            console.error("[UnusedItemScanner] scan failed", e);
                            return push({
                                type: "scanDone",
                                cancelled: false,
                                items: [],
                                warnings: [`Scan failed: ${(e as any)?.message ?? e}`],
                                stats: { unitsScanned: 0, durationMs: 0, candidates: 0 }
                            });
                        })
                        .finally(() => {
                            busy = undefined;
                        });
                    return;
                }

                case "cancelScan": {
                    cancelRequested = true;
                    await reply(messageId, { type: "ack", ok: true });
                    return;
                }

                case "delete": {
                    if (busy) {
                        await reply(messageId, { type: "ack", ok: false, error: `A ${busy} is already running.` });
                        return;
                    }
                    busy = "delete";
                    await reply(messageId, { type: "ack", ok: true });
                    void runDelete(studioPro, message.items, (done, total) => void push({ type: "deleteProgress", done, total }))
                        .then((result) => push(result))
                        .catch((e) => {
                            console.error("[UnusedItemScanner] delete failed", e);
                            return push({
                                type: "deleteDone",
                                deletedKeys: [],
                                errors: [{ key: "", message: `Delete failed: ${(e as any)?.message ?? e}` }]
                            });
                        })
                        .finally(() => {
                            busy = undefined;
                        });
                    return;
                }

                case "open": {
                    const { item } = message;
                    try {
                        if (item.kind === "document") {
                            await studioPro.ui.editors.editDocument({ id: item.unitId });
                        } else {
                            // Opens the domain model and focuses the entity / association; attributes focus their entity.
                            const focusId = item.kind === "attribute" ? item.parentId! : item.elementId;
                            await studioPro.ui.editors.editDocument({ id: item.unitId }, { id: focusId });
                        }
                        await reply(messageId, { type: "ack", ok: true });
                    } catch (e) {
                        console.error("[UnusedItemScanner] open failed", e);
                        await reply(messageId, { type: "ack", ok: false, error: (e as any)?.message ?? String(e) });
                    }
                    return;
                }
            }
        });
    }
};
